use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};

use serde_json::{json, Value};

use crate::{editor_run::EditorLanguage, storage::Storage};

use super::{journal::SHARED_JOURNAL, *};

fn store(directory: &Path) -> Arc<DraftStore> {
    DraftStore::new(directory.to_owned())
}

fn batch(id: &str, base_revision: u64, changes: Value) -> DraftBatch {
    serde_json::from_value(json!({
        "id": id,
        "baseRevision": base_revision,
        "changes": changes,
    }))
    .unwrap()
}

fn append_to_file(path: &Path, suffix: &[u8]) {
    let mut file = OpenOptions::new().append(true).open(path).unwrap();
    file.write_all(suffix).unwrap();
    file.sync_all().unwrap();
}

#[test]
fn restores_legacy_drafts_and_applies_ordered_utf16_edits_to_each_language() -> Result<()> {
    let directory = tempfile::tempdir().unwrap();
    let first = file_name("sample:editor:1")?;
    let second = file_name("sample:editor:2")?;
    Storage::new(directory.path().to_owned())
        .write(
            &first,
            &json!({
                "drafts": { "cpp": "甲😀\r\n乙\r丙", "python": "x\rfoo" }
            }),
        )
        .unwrap();
    let drafts = store(directory.path());
    assert!(drafts.get(&second)?.is_none());
    let legacy = drafts.get(&first)?.unwrap();
    assert_eq!(legacy.revision, 0);
    assert_eq!(legacy.draft.language, None);
    assert_eq!(legacy.draft.drafts.cpp, "甲😀\r\n乙\r丙");
    let changes = batch(
        "unicode",
        0,
        json!([
            { "kind": "edit", "language": "cpp", "changes": [
                { "from": 1, "to": 3, "insert": "🙂" },
                { "from": 5, "to": 6, "insert": "\r\n!" }
            ] },
            { "kind": "edit", "language": "python", "changes": [
                { "from": 2, "to": 5, "insert": "bar" }
            ] }
        ]),
    );
    assert_eq!(drafts.append(&first, changes)?, 1);
    let reopened = store(directory.path());
    let detail = serde_json::to_value(reopened.get(&first)?.unwrap()).unwrap();
    assert_eq!(
        detail,
        json!({
            "revision": 1,
            "language": "python",
            "drafts": { "cpp": "甲🙂\n乙\n!丙", "python": "x\nbar" }
        })
    );
    assert!(reopened.get(&second)?.is_none());
    Ok(())
}

#[test]
fn ignores_torn_tail_and_skips_compacted_records_and_acknowledged_retries() -> Result<()> {
    let directory = tempfile::tempdir().unwrap();
    let name = file_name("sample:editor:1")?;
    let journal = directory.path().join(SHARED_JOURNAL);
    let drafts = store(directory.path());
    let first = || {
        batch(
            "first",
            0,
            json!([{ "kind": "restore", "draft": {
            "language": "python",
            "drafts": { "cpp": "sample", "python": "print(1)" }
        } }]),
        )
    };
    let second = || {
        batch(
            "second",
            1,
            json!([{ "kind": "edit", "language": "cpp", "changes": [
            { "from": 6, "to": 6, "insert": "d" }
        ] }]),
        )
    };
    assert_eq!(drafts.append(&name, first())?, 1);
    append_to_file(&journal, b"{incomplete");
    drop(drafts);

    let reopened = store(directory.path());
    assert_eq!(reopened.get(&name)?.unwrap().revision, 1);
    assert_eq!(reopened.append(&name, second())?, 2);
    assert_eq!(reopened.append(&name, second())?, 2);
    assert_eq!(
        reopened.append(&name, first()).unwrap_err().code,
        "draft_revision_conflict"
    );
    let retained = fs::read_to_string(&journal).unwrap();
    assert_eq!(retained.lines().count(), 2);
    assert!(!retained.contains("incomplete"));
    assert!(!directory.path().join(&name).exists());

    reopened.checkpoint()?;
    reopened.checkpoint()?;
    assert_eq!(fs::metadata(&journal).unwrap().len(), 0);
    // A crash after replacing the snapshot can leave its already compacted journal in place.
    fs::write(&journal, retained).unwrap();
    drop(reopened);

    let recovered = store(directory.path());
    let draft = recovered.get(&name)?.unwrap();
    assert_eq!(draft.revision, 2);
    assert_eq!(draft.draft.drafts.cpp, "sampled");
    assert_eq!(draft.draft.drafts.python, "print(1)");
    assert_eq!(recovered.append(&name, second())?, 2);
    let third = batch(
        "third",
        2,
        json!([{ "kind": "language", "language": "python" }]),
    );
    assert_eq!(recovered.append(&name, third)?, 3);
    drop(recovered);
    let latest = store(directory.path()).get(&name)?.unwrap();
    assert_eq!(latest.revision, 3);
    assert_eq!(latest.draft.language, Some(EditorLanguage::Python));
    assert_eq!(latest.draft.drafts.cpp, "sampled");
    Ok(())
}

#[test]
fn rejects_invalid_ranges_and_revision_gaps_without_discarding_confirmed_data() -> Result<()> {
    let directory = tempfile::tempdir().unwrap();
    let name = file_name("sample:editor:1")?;
    let journal = directory.path().join(SHARED_JOURNAL);
    let drafts = store(directory.path());
    let source = batch(
        "first",
        0,
        json!([{ "kind": "restore", "draft": { "drafts": { "cpp": "😀ab", "python": "" } } }]),
    );
    drafts.append(&name, source)?;
    let existing = fs::read(&journal).unwrap();
    for changes in [
        json!([{ "from": 1, "to": 2, "insert": "." }]),
        json!([{ "from": 2, "to": 4, "insert": "." }, { "from": 3, "to": 4, "insert": "?" }]),
        json!([{ "from": 2, "to": 5, "insert": "." }]),
    ] {
        let invalid = batch(
            "edited",
            1,
            json!([{ "kind": "edit", "language": "cpp", "changes": changes }]),
        );
        assert_eq!(
            drafts.append(&name, invalid).unwrap_err().code,
            "invalid_draft_batch"
        );
        assert_eq!(fs::read(&journal).unwrap(), existing);
    }
    drop(drafts);
    let gap = batch(
        "gap",
        2,
        json!([{ "kind": "language", "language": "python" }]),
    );
    let mut record = serde_json::to_vec(&json!({ "fileName": name, "batch": gap })).unwrap();
    record.push(b'\n');
    append_to_file(&journal, &record);
    let reopened = store(directory.path());
    assert_eq!(reopened.get(&name).unwrap_err().code, "draft_read_failed");
    assert_eq!(
        reopened.append(&name, gap).unwrap_err().code,
        "draft_read_failed"
    );
    assert_eq!(fs::read(&journal).unwrap(), [existing, record].concat());
    Ok(())
}

#[test]
fn enforces_the_size_limit_after_the_entire_batch_without_writing_a_snapshot() -> Result<()> {
    let directory = tempfile::tempdir().unwrap();
    let name = file_name("sample:editor:1")?;
    let journal = directory.path().join(SHARED_JOURNAL);
    let drafts = store(directory.path());
    let add_large_text = json!({
        "kind": "edit", "language": "python", "changes": [
            { "from": 0, "to": 0, "insert": "a".repeat(MAX_DRAFT_BYTES + 1) }
        ]
    });
    let oversized = batch("large", 0, json!([add_large_text]));
    assert_eq!(
        drafts.append(&name, oversized).unwrap_err().code,
        "draft_too_large"
    );
    assert!(!journal.exists());
    assert!(drafts.get(&name)?.is_none());
    let shrink = json!({
        "kind": "edit", "language": "python", "changes": [
            { "from": MAX_DRAFT_BYTES, "to": MAX_DRAFT_BYTES + 1, "insert": "" }
        ]
    });
    let repaired = batch("large", 0, json!([add_large_text, shrink]));
    assert_eq!(drafts.append(&name, repaired)?, 1);
    assert_eq!(
        drafts.get(&name)?.unwrap().draft.drafts.python.len(),
        MAX_DRAFT_BYTES
    );
    assert!(fs::metadata(journal).unwrap().len() > MAX_DRAFT_BYTES as u64);
    assert!(!directory.path().join(name).exists());
    Ok(())
}

#[test]
fn preserves_the_shared_journal_when_a_checkpoint_can_only_write_some_snapshots() -> Result<()> {
    let directory = tempfile::tempdir().unwrap();
    let mut names = [file_name("sample:editor:1")?, file_name("sample:editor:2")?];
    names.sort_unstable();
    let [first_name, second_name] = names;
    let journal = directory.path().join(SHARED_JOURNAL);
    let drafts = store(directory.path());
    let first = || {
        batch(
            "first",
            0,
            json!([{ "kind": "language", "language": "cpp" }]),
        )
    };
    let second = batch(
        "second",
        0,
        json!([{ "kind": "language", "language": "python" }]),
    );
    drafts.append(&first_name, first())?;
    drafts.append(&second_name, second)?;

    let first_snapshot = directory.path().join(&first_name);
    let blocked = directory.path().join(&second_name);
    fs::create_dir(&blocked).unwrap();
    let durable = fs::read(&journal).unwrap();
    assert_eq!(drafts.checkpoint().unwrap_err().code, "draft_save_failed");
    assert!(first_snapshot.is_file());
    assert_eq!(fs::read(&journal).unwrap(), durable);
    fs::remove_dir(&blocked).unwrap();
    drop(drafts);

    let recovered = store(directory.path());
    recovered.checkpoint()?;
    assert_eq!(recovered.append(&first_name, first())?, 1);
    let second = recovered.get(&second_name)?.unwrap();
    assert_eq!(second.revision, 1);
    assert_eq!(second.draft.language, Some(EditorLanguage::Python));
    assert!(blocked.is_file());
    assert_eq!(fs::metadata(&journal).unwrap().len(), 0);
    Ok(())
}

#[test]
fn restores_per_problem_journals_before_the_shared_history_and_cleans_them_after_checkpoint(
) -> Result<()> {
    let directory = tempfile::tempdir().unwrap();
    let name = file_name("sample:editor:1")?;
    let legacy = directory.path().join(&name).with_extension("journal");
    let snapshot = directory.path().join(&name);
    let shared = directory.path().join(SHARED_JOURNAL);
    let old = batch(
        "old",
        0,
        json!([{ "kind": "edit", "language": "cpp", "changes": [
            { "from": 0, "to": 0, "insert": "old" }
        ] }]),
    );
    let mut legacy_bytes = serde_json::to_vec(&old).unwrap();
    legacy_bytes.extend_from_slice(b"\n{partial");
    fs::write(&legacy, &legacy_bytes).unwrap();

    let drafts = store(directory.path());
    assert_eq!(drafts.get(&name)?.unwrap().revision, 1);
    let new = || {
        batch(
            "new",
            1,
            json!([{ "kind": "edit", "language": "cpp", "changes": [
            { "from": 3, "to": 3, "insert": " + new" }
        ] }]),
        )
    };
    assert_eq!(drafts.append(&name, new())?, 2);
    assert_eq!(fs::read(&legacy).unwrap(), legacy_bytes);
    assert!(!snapshot.exists());
    drop(drafts);

    let restored = store(directory.path());
    restored.checkpoint()?;
    assert!(snapshot.is_file());
    assert!(!legacy.exists());
    assert_eq!(fs::metadata(shared).unwrap().len(), 0);
    drop(restored);
    let reopened = store(directory.path());
    let loaded = reopened.get(&name)?.unwrap();
    assert_eq!(loaded.revision, 2);
    assert_eq!(loaded.draft.drafts.cpp, "old + new");
    assert_eq!(reopened.append(&name, new())?, 2);
    Ok(())
}

#[test]
fn checkpoints_interleaved_drafts_even_after_they_leave_the_memory_cache() -> Result<()> {
    let directory = tempfile::tempdir().unwrap();
    let drafts = store(directory.path());
    for index in 1..=18 {
        let name = file_name(&format!("sample:editor:{index}"))?;
        let change = batch(
            "first",
            0,
            json!([{ "kind": "edit", "language": "python", "changes": [
                { "from": 0, "to": 0, "insert": index.to_string() }
            ] }]),
        );
        assert_eq!(drafts.append(&name, change)?, 1);
    }
    let first = file_name("sample:editor:1")?;
    assert_eq!(
        drafts.append(
            &first,
            batch(
                "second",
                1,
                json!([{ "kind": "language", "language": "cpp" }])
            )
        )?,
        2
    );
    let filenames: Vec<_> = fs::read_dir(directory.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    assert_eq!(filenames, [SHARED_JOURNAL]);

    drafts.checkpoint()?;
    let reopened = store(directory.path());
    for index in 1..=18 {
        let name = file_name(&format!("sample:editor:{index}"))?;
        assert!(directory.path().join(&name).is_file());
        let loaded = reopened.get(&name)?.unwrap();
        assert_eq!(loaded.revision, if index == 1 { 2 } else { 1 });
        assert_eq!(loaded.draft.drafts.python, index.to_string());
    }
    Ok(())
}

#[test]
fn rejects_shared_records_with_non_hash_snapshot_filenames() -> Result<()> {
    let directory = tempfile::tempdir().unwrap();
    let journal = directory.path().join(SHARED_JOURNAL);
    let name = file_name("sample:editor:1")?;
    let invalid = format!(
        "{}\n",
        json!({
            "fileName": "../elsewhere.json",
            "batch": { "id": "first", "baseRevision": 0, "changes": [{ "kind": "language", "language": "cpp" }] }
        })
    );
    fs::write(&journal, &invalid).unwrap();
    let drafts = store(directory.path());
    assert_eq!(drafts.get(&name).unwrap_err().code, "draft_read_failed");
    assert_eq!(drafts.checkpoint().unwrap_err().code, "draft_read_failed");
    assert_eq!(fs::read_to_string(&journal).unwrap(), invalid);
    Ok(())
}

#[test]
fn validates_problem_ids_and_keeps_one_result_per_base_revision() -> Result<()> {
    for problem_id in [
        "",
        "../file",
        "sample:editor:0",
        "sample:editor:1:2",
        "sample:editor:01",
        "sample:editor:+1",
    ] {
        assert_eq!(
            file_name(problem_id).unwrap_err().code,
            "invalid_problem_id"
        );
    }
    let directory = tempfile::tempdir().unwrap();
    let name = file_name("sample:editor:1")?;
    let drafts = store(directory.path());
    let results = std::thread::scope(|scope| {
        let first = scope.spawn(|| {
            drafts.append(
                &name,
                batch(
                    "same-base-a",
                    0,
                    json!([{ "kind": "language", "language": "cpp" }]),
                ),
            )
        });
        let second = scope.spawn(|| {
            drafts.append(
                &name,
                batch(
                    "same-base-b",
                    0,
                    json!([{ "kind": "language", "language": "python" }]),
                ),
            )
        });
        [first.join().unwrap(), second.join().unwrap()]
    });
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .into_iter()
            .find_map(|result| result.err())
            .unwrap()
            .code,
        "draft_revision_conflict"
    );
    assert_eq!(drafts.get(&name)?.unwrap().revision, 1);
    Ok(())
}
