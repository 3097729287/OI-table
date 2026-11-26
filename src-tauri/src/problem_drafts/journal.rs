use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{self, BufRead, BufReader, Read, Seek, SeekFrom, Write},
    ops::Range,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
    thread,
    time::{Duration, Instant},
};

use serde::{de::IgnoredAny, Deserialize, Serialize};

use crate::storage::Storage;

use super::{
    model::{batch_too_large, DraftBatch, ProblemDraft, VersionedDraft},
    ProblemDraftError, Result, MAX_SAFE_INTEGER,
};

pub(super) const SHARED_JOURNAL: &str = "operations.journal";
const CHECKPOINT_INTERVAL: Duration = Duration::from_secs(20 * 60);
const MAX_RECORD_BYTES: u64 = 64 * 1024 * 1024;
const CACHE_ENTRIES: usize = 16;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    #[serde(default)]
    revision: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_batch_id: Option<String>,
    #[serde(flatten)]
    draft: ProblemDraft,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Record<Name, Batch> {
    file_name: Name,
    batch: Batch,
}

struct CachedDraft {
    snapshot: Option<Snapshot>,
    checkpoint_revision: u64,
    last_access: Instant,
}

impl CachedDraft {
    fn revision(&self) -> u64 {
        self.snapshot
            .as_ref()
            .map_or(0, |snapshot| snapshot.revision)
    }

    fn apply(&self, batch: &DraftBatch, revision: u64) -> Result<Snapshot> {
        let draft = self
            .snapshot
            .as_ref()
            .map(|snapshot| snapshot.draft.clone())
            .unwrap_or_default();
        Ok(Snapshot {
            revision,
            last_batch_id: Some(batch.id.clone()),
            draft: batch.apply(draft)?,
        })
    }

    fn replay(&mut self, batch: &DraftBatch) -> io::Result<()> {
        let revision = batch.next_revision().map_err(|_| invalid_journal())?;
        if revision <= self.checkpoint_revision {
            return Ok(());
        }
        if batch.base_revision != self.revision() {
            return Err(invalid_journal());
        }
        self.snapshot = Some(self.apply(batch, revision).map_err(|_| invalid_journal())?);
        Ok(())
    }
}

#[derive(Default)]
struct History {
    legacy: bool,
    records: Vec<Range<u64>>,
}

#[derive(Default)]
struct JournalState {
    complete_bytes: u64,
    torn_tail: bool,
    histories: HashMap<String, History>,
    cache: HashMap<String, CachedDraft>,
}

pub(super) struct DraftStore {
    directory: PathBuf,
    snapshots: Storage,
    state: Mutex<Option<JournalState>>,
}

fn io_error(code: &'static str, message: &'static str, error: io::Error) -> ProblemDraftError {
    log::warn!("{message} ({:?})", error.kind());
    ProblemDraftError::new(code, message)
}

fn read_error(error: io::Error) -> ProblemDraftError {
    io_error(
        "draft_read_failed",
        "Could not read the problem draft",
        error,
    )
}

fn save_error(error: io::Error) -> ProblemDraftError {
    io_error(
        "draft_save_failed",
        "Could not save the problem draft",
        error,
    )
}

fn invalid_journal() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "Invalid draft journal record")
}

fn valid_draft_file(name: &str) -> bool {
    name.strip_suffix(".json").is_some_and(|hash| {
        hash.len() == 64
            && hash
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

fn regular_file_exists(path: &Path) -> io::Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() => Ok(true),
        Ok(_) => Err(invalid_journal()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

fn read_record(reader: &mut impl BufRead, bytes: &mut Vec<u8>) -> io::Result<bool> {
    bytes.clear();
    reader.take(MAX_RECORD_BYTES + 1).read_until(b'\n', bytes)?;
    if bytes.len() as u64 > MAX_RECORD_BYTES {
        return Err(invalid_journal());
    }
    // A final write interrupted before its newline is incomplete.
    Ok(bytes.last() == Some(&b'\n'))
}

impl DraftStore {
    pub(super) fn new(directory: PathBuf) -> Arc<Self> {
        Arc::new(Self {
            snapshots: Storage::new(directory.clone()),
            directory,
            state: Mutex::new(None),
        })
    }

    pub(super) fn start_compaction(self: &Arc<Self>) -> io::Result<()> {
        let store = Arc::downgrade(self);
        thread::Builder::new()
            .name("problem-draft-checkpoint".into())
            .spawn(move || loop {
                thread::sleep(CHECKPOINT_INTERVAL);
                let Some(store) = store.upgrade() else { break };
                if let Err(error) = store.checkpoint() {
                    log::warn!("Could not checkpoint problem drafts ({})", error.code);
                }
            })?;
        Ok(())
    }

    fn lock_state(&self) -> io::Result<MutexGuard<'_, Option<JournalState>>> {
        self.state
            .lock()
            .map_err(|_| io::Error::other("Draft journal lock is poisoned"))
    }

    fn initialized<'state>(
        &self,
        state: &'state mut Option<JournalState>,
    ) -> io::Result<&'state mut JournalState> {
        if state.is_none() {
            *state = Some(self.index_journals()?);
        }
        Ok(state.as_mut().expect("initialized draft journal"))
    }

    pub(super) fn get(&self, name: &str) -> Result<Option<VersionedDraft>> {
        let mut locked = self.lock_state().map_err(read_error)?;
        let state = self.initialized(&mut locked).map_err(read_error)?;
        let entry = self.entry(state, name).map_err(read_error)?;
        Ok(entry.snapshot.as_ref().map(|snapshot| VersionedDraft {
            revision: snapshot.revision,
            draft: snapshot.draft.clone(),
        }))
    }

    pub(super) fn append(&self, name: &str, batch: DraftBatch) -> Result<u64> {
        let revision = batch.next_revision()?;
        let mut locked = self.lock_state().map_err(save_error)?;
        let state = self.initialized(&mut locked).map_err(read_error)?;
        let start = state.complete_bytes;
        let entry = self.entry(state, name).map_err(read_error)?;
        let conflict =
            || ProblemDraftError::new("draft_revision_conflict", "The problem draft has changed");
        if entry
            .snapshot
            .as_ref()
            .and_then(|snapshot| snapshot.last_batch_id.as_deref())
            == Some(batch.id.as_str())
        {
            return if entry.revision() == revision {
                Ok(revision)
            } else {
                Err(conflict())
            };
        }
        if entry.revision() != batch.base_revision {
            return Err(conflict());
        }

        let snapshot = entry.apply(&batch, revision)?;
        let mut record = serde_json::to_vec(&Record {
            file_name: name,
            batch: &batch,
        })
        .map_err(|error| save_error(io::Error::other(error)))?;
        record.push(b'\n');
        if record.len() as u64 > MAX_RECORD_BYTES {
            return Err(batch_too_large());
        }
        self.append_record(start, &record).map_err(save_error)?;
        entry.snapshot = Some(snapshot);
        let end = start + record.len() as u64;
        state
            .histories
            .entry(name.to_owned())
            .or_default()
            .records
            .push(start..end);
        state.complete_bytes = end;
        state.torn_tail = false;
        Ok(revision)
    }

    fn entry<'state>(
        &self,
        state: &'state mut JournalState,
        name: &str,
    ) -> io::Result<&'state mut CachedDraft> {
        if !valid_draft_file(name) {
            return Err(invalid_journal());
        }
        if !state.cache.contains_key(name) {
            let new = self.recover(name, state.histories.get(name))?;
            if state.cache.len() >= CACHE_ENTRIES {
                let oldest = state
                    .cache
                    .iter()
                    .min_by_key(|(_, entry)| entry.last_access)
                    .map(|(name, _)| name.clone())
                    .expect("nonempty draft cache");
                state.cache.remove(&oldest);
            }
            state.cache.insert(name.to_owned(), new);
        }
        let entry = state.cache.get_mut(name).expect("cached draft");
        entry.last_access = Instant::now();
        Ok(entry)
    }

    fn shared_journal(&self) -> PathBuf {
        self.directory.join(SHARED_JOURNAL)
    }

    fn legacy_journal(&self, name: &str) -> PathBuf {
        self.directory.join(name).with_extension("journal")
    }

    fn index_journals(&self) -> io::Result<JournalState> {
        let mut state = JournalState::default();
        let directory = match fs::read_dir(&self.directory) {
            Ok(directory) => directory,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(state),
            Err(error) => return Err(error),
        };
        for entry in directory {
            let entry = entry?;
            let name = entry.file_name();
            let Some(hash) = name.to_str().and_then(|name| name.strip_suffix(".journal")) else {
                continue;
            };
            let snapshot = format!("{hash}.json");
            if valid_draft_file(&snapshot) {
                if !entry.file_type()?.is_file() {
                    return Err(invalid_journal());
                }
                state.histories.entry(snapshot).or_default().legacy = true;
            }
        }

        let path = self.shared_journal();
        if regular_file_exists(&path)? {
            let mut reader = BufReader::new(File::open(path)?);
            let mut bytes = Vec::new();
            while read_record(&mut reader, &mut bytes)? {
                let record: Record<String, IgnoredAny> =
                    serde_json::from_slice(&bytes).map_err(|_| invalid_journal())?;
                if !valid_draft_file(&record.file_name) {
                    return Err(invalid_journal());
                }
                let start = state.complete_bytes;
                state.complete_bytes += bytes.len() as u64;
                state
                    .histories
                    .entry(record.file_name)
                    .or_default()
                    .records
                    .push(start..state.complete_bytes);
            }
            state.torn_tail = !bytes.is_empty();
        }
        Ok(state)
    }

    fn recover(&self, name: &str, history: Option<&History>) -> io::Result<CachedDraft> {
        let snapshot: Option<Snapshot> = if regular_file_exists(&self.directory.join(name))? {
            self.snapshots.read(name)?
        } else {
            None
        };
        let checkpoint_revision = snapshot.as_ref().map_or(0, |snapshot| snapshot.revision);
        if checkpoint_revision > MAX_SAFE_INTEGER {
            return Err(invalid_journal());
        }
        let mut entry = CachedDraft {
            snapshot,
            checkpoint_revision,
            last_access: Instant::now(),
        };
        let Some(history) = history else {
            return Ok(entry);
        };
        let mut bytes = Vec::new();
        if history.legacy {
            // Per-problem journals precede the shared one until a checkpoint merges both.
            let path = self.legacy_journal(name);
            if !regular_file_exists(&path)? {
                return Err(invalid_journal());
            }
            let mut reader = BufReader::new(File::open(path)?);
            while read_record(&mut reader, &mut bytes)? {
                let batch: DraftBatch =
                    serde_json::from_slice(&bytes).map_err(|_| invalid_journal())?;
                entry.replay(&batch)?;
            }
        }
        if !history.records.is_empty() {
            let path = self.shared_journal();
            if !regular_file_exists(&path)? {
                return Err(invalid_journal());
            }
            let mut file = File::open(path)?;
            for range in &history.records {
                file.seek(SeekFrom::Start(range.start))?;
                bytes.resize((range.end - range.start) as usize, 0);
                file.read_exact(&mut bytes)?;
                let record: Record<String, DraftBatch> =
                    serde_json::from_slice(&bytes).map_err(|_| invalid_journal())?;
                if record.file_name != name || bytes.last() != Some(&b'\n') {
                    return Err(invalid_journal());
                }
                entry.replay(&record.batch)?;
            }
        }
        Ok(entry)
    }

    fn append_record(&self, start: u64, record: &[u8]) -> io::Result<()> {
        let path = self.shared_journal();
        regular_file_exists(&path)?;
        let mut options = OpenOptions::new();
        options.write(true).create(true).truncate(false);
        let mut file = match options.open(&path) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                fs::create_dir_all(&self.directory)?;
                if let Some(parent) = self.directory.parent() {
                    sync_directory(parent)?;
                }
                options.open(&path)?
            }
            result => result?,
        };
        let actual = file.metadata()?.len();
        if actual < start {
            return Err(invalid_journal());
        }
        if actual > start {
            file.set_len(start)?;
        }
        file.seek(SeekFrom::Start(start))?;
        file.write_all(record)?;
        file.sync_all()?;
        if start == 0 {
            sync_directory(&self.directory)?;
        }
        Ok(())
    }

    pub(super) fn checkpoint(&self) -> Result<()> {
        let mut locked = self.lock_state().map_err(save_error)?;
        let state = self.initialized(&mut locked).map_err(read_error)?;
        self.write_checkpoint(state).map_err(save_error)
    }

    fn write_checkpoint(&self, state: &mut JournalState) -> io::Result<()> {
        if state.histories.is_empty() && !state.torn_tail {
            return Ok(());
        }
        let mut names: Vec<_> = state.histories.keys().cloned().collect();
        names.sort_unstable();
        for name in &names {
            let entry = self.entry(state, name)?;
            if entry.revision() > entry.checkpoint_revision {
                let snapshot = entry.snapshot.as_ref().ok_or_else(invalid_journal)?;
                self.snapshots.write(name, snapshot)?;
                #[cfg(windows)]
                OpenOptions::new()
                    .write(true)
                    .open(self.directory.join(name))?
                    .sync_all()?;
                entry.checkpoint_revision = snapshot.revision;
            }
        }

        // All replacements must be durable before any recovery history is cleared.
        sync_directory(&self.directory)?;
        for name in &names {
            let history = state.histories.get_mut(name).expect("draft history");
            if history.legacy {
                fs::remove_file(self.legacy_journal(name))?;
                history.legacy = false;
            }
        }
        let shared = self.shared_journal();
        let journal = if regular_file_exists(&shared)? {
            let file = OpenOptions::new().write(true).open(shared)?;
            if file.metadata()?.len() < state.complete_bytes {
                return Err(invalid_journal());
            }
            file.set_len(0)?;
            Some(file)
        } else if state.complete_bytes > 0 {
            return Err(invalid_journal());
        } else {
            None
        };
        state.histories.clear();
        state.complete_bytes = 0;
        state.torn_tail = false;
        if let Some(file) = journal {
            file.sync_all()?;
        }
        sync_directory(&self.directory)?;
        Ok(())
    }
}

fn sync_directory(directory: &Path) -> io::Result<()> {
    #[cfg(unix)]
    File::open(directory)?.sync_all()?;
    #[cfg(not(unix))]
    let _ = directory;
    Ok(())
}
