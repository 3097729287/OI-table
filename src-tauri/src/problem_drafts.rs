use std::sync::Arc;

use sha2::{Digest, Sha256};
use tauri::{App, Manager, State};

use journal::DraftStore;
use model::{DraftBatch, VersionedDraft};

mod journal;
mod model;

#[cfg(test)]
mod tests;

const MAX_DRAFT_BYTES: usize = 1024 * 1024;
const MAX_PROBLEM_ID_BYTES: usize = 146;
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

pub(crate) struct ProblemDraftStorage(Arc<DraftStore>);

#[derive(Debug, serde::Serialize)]
pub(crate) struct ProblemDraftError {
    code: &'static str,
    message: &'static str,
}

impl ProblemDraftError {
    fn new(code: &'static str, message: &'static str) -> Self {
        Self { code, message }
    }
}

type Result<T> = std::result::Result<T, ProblemDraftError>;

pub(crate) fn setup(app: &App) -> tauri::Result<()> {
    let directory = app.path().app_data_dir()?.join("problem-drafts");
    let store = DraftStore::new(directory);
    store.start_compaction()?;
    app.manage(ProblemDraftStorage(store));
    Ok(())
}

fn file_name(problem_id: &str) -> Result<String> {
    let invalid = || ProblemDraftError::new("invalid_problem_id", "Invalid problem ID");
    if problem_id.len() > MAX_PROBLEM_ID_BYTES {
        return Err(invalid());
    }
    let mut parts = problem_id.split(':');
    let valid_name = |name: &str| {
        let mut bytes = name.bytes();
        let alphanumeric = |byte: u8| byte.is_ascii_lowercase() || byte.is_ascii_digit();
        name.len() <= 64
            && bytes.next().is_some_and(alphanumeric)
            && bytes.all(|byte| alphanumeric(byte) || matches!(byte, b'-' | b'_'))
    };
    if !parts.next().is_some_and(valid_name) || !parts.next().is_some_and(valid_name) {
        return Err(invalid());
    }
    let valid_sequence = parts.next().is_some_and(|sequence| {
        sequence
            .as_bytes()
            .first()
            .is_some_and(|byte| matches!(*byte, b'1'..=b'9'))
            && sequence
                .parse::<u64>()
                .is_ok_and(|number| number <= MAX_SAFE_INTEGER)
    });
    if !valid_sequence || parts.next().is_some() {
        return Err(invalid());
    }
    Ok(format!("{:x}.json", Sha256::digest(problem_id.as_bytes())))
}

async fn run<T: Send + 'static>(
    storage: &ProblemDraftStorage,
    operation: impl FnOnce(&DraftStore) -> Result<T> + Send + 'static,
) -> Result<T> {
    let storage = Arc::clone(&storage.0);
    tauri::async_runtime::spawn_blocking(move || operation(&storage))
        .await
        .map_err(|_| {
            ProblemDraftError::new(
                "draft_worker_failed",
                "Could not access problem draft storage",
            )
        })?
}

#[tauri::command]
pub(crate) async fn get_problem_draft(
    storage: State<'_, ProblemDraftStorage>,
    problem_id: String,
) -> Result<Option<VersionedDraft>> {
    let name = file_name(&problem_id)?;
    run(&storage, move |storage| storage.get(&name)).await
}

#[tauri::command]
pub(crate) async fn append_problem_draft(
    storage: State<'_, ProblemDraftStorage>,
    problem_id: String,
    batch: DraftBatch,
) -> Result<u64> {
    let name = file_name(&problem_id)?;
    run(&storage, move |storage| storage.append(&name, batch)).await
}

#[tauri::command]
pub(crate) async fn checkpoint_problem_drafts(
    storage: State<'_, ProblemDraftStorage>,
) -> Result<()> {
    run(&storage, DraftStore::checkpoint).await
}
