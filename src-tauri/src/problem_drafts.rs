use std::sync::Arc;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{App, Manager, State};

use crate::{editor_run::EditorLanguage, storage::Storage};

const MAX_DRAFT_BYTES: usize = 1024 * 1024;
const MAX_PROBLEM_ID_BYTES: usize = 146;

pub(crate) struct ProblemDraftStorage(Arc<Storage>);

#[derive(Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ProblemDraft {
    language: EditorLanguage,
    drafts: DraftContents,
}

#[derive(Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct DraftContents {
    cpp: String,
    python: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct ProblemDraftError {
    code: &'static str,
    message: &'static str,
}

type Result<T> = std::result::Result<T, ProblemDraftError>;

pub(crate) fn setup(app: &App) -> tauri::Result<()> {
    let directory = app.path().app_data_dir()?.join("problem-drafts");
    app.manage(ProblemDraftStorage(Arc::new(Storage::new(directory))));
    Ok(())
}

fn file_name(problem_id: &str) -> Result<String> {
    let invalid = || ProblemDraftError {
        code: "invalid_problem_id",
        message: "Invalid problem ID",
    };
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
                .is_ok_and(|number| number <= (1 << 53) - 1)
    });
    if !valid_sequence || parts.next().is_some() {
        return Err(invalid());
    }
    Ok(format!("{:x}.json", Sha256::digest(problem_id.as_bytes())))
}

fn read_draft(storage: &Storage, name: &str) -> Result<Option<ProblemDraft>> {
    // Windows can reject replacing a file while another thread is reading it.
    storage
        .with_write_lock(|| storage.read(name))
        .map_err(|error| {
            log::warn!("Could not read the problem draft ({:?})", error.kind());
            ProblemDraftError {
                code: "draft_read_failed",
                message: "Could not read the problem draft",
            }
        })
}

fn write_draft(storage: &Storage, name: &str, draft: &ProblemDraft) -> Result<()> {
    if draft.drafts.cpp.len() > MAX_DRAFT_BYTES || draft.drafts.python.len() > MAX_DRAFT_BYTES {
        return Err(ProblemDraftError {
            code: "draft_too_large",
            message: "A draft can contain up to 1 MiB of code per language",
        });
    }
    storage
        .with_write_lock(|| storage.write(name, draft))
        .map_err(|error| {
            log::warn!("Could not save the problem draft ({:?})", error.kind());
            ProblemDraftError {
                code: "draft_save_failed",
                message: "Could not save the problem draft",
            }
        })
}

async fn run<T: Send + 'static>(
    storage: &ProblemDraftStorage,
    operation: impl FnOnce(&Storage) -> Result<T> + Send + 'static,
) -> Result<T> {
    let storage = Arc::clone(&storage.0);
    tauri::async_runtime::spawn_blocking(move || operation(&storage))
        .await
        .map_err(|_| ProblemDraftError {
            code: "draft_worker_failed",
            message: "Could not access problem draft storage",
        })?
}

#[tauri::command]
pub(crate) async fn get_problem_draft(
    storage: State<'_, ProblemDraftStorage>,
    problem_id: String,
) -> Result<Option<ProblemDraft>> {
    let name = file_name(&problem_id)?;
    run(&storage, move |storage| read_draft(storage, &name)).await
}

#[tauri::command]
pub(crate) async fn save_problem_draft(
    storage: State<'_, ProblemDraftStorage>,
    problem_id: String,
    draft: ProblemDraft,
) -> Result<()> {
    let name = file_name(&problem_id)?;
    run(&storage, move |storage| write_draft(storage, &name, &draft)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft(language: EditorLanguage, cpp: &str, python: &str) -> ProblemDraft {
        ProblemDraft {
            language,
            drafts: DraftContents {
                cpp: cpp.into(),
                python: python.into(),
            },
        }
    }

    #[test]
    fn persists_independent_drafts_and_both_languages() -> Result<()> {
        let directory = tempfile::tempdir().unwrap();
        let directory = directory.path().join("problem-drafts");
        let first = file_name("sample:editor:1")?;
        let second = file_name("sample:editor:2")?;
        let storage = Storage::new(directory.clone());
        assert_eq!(read_draft(&storage, &first)?, None);
        write_draft(
            &storage,
            &first,
            &draft(EditorLanguage::Cpp, "int main() {}", ""),
        )?;
        write_draft(
            &storage,
            &second,
            &draft(EditorLanguage::Python, "", "print(2)"),
        )?;
        let updated = draft(
            EditorLanguage::Python,
            "// 草稿\nint main() {}\n",
            "print('草稿')\n",
        );
        write_draft(&storage, &first, &updated)?;

        let reopened = Storage::new(directory);
        assert_eq!(read_draft(&reopened, &first)?, Some(updated));
        assert_eq!(
            read_draft(&reopened, &second)?,
            Some(draft(EditorLanguage::Python, "", "print(2)"))
        );
        Ok(())
    }

    #[test]
    fn rejects_invalid_ids_and_keeps_saved_draft_after_oversized_write() -> Result<()> {
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
        let storage = Storage::new(directory.path().to_owned());
        let name = file_name("sample:editor:1")?;
        let large = "a".repeat(MAX_DRAFT_BYTES);
        let saved = draft(EditorLanguage::Cpp, &large, "print(1)");
        write_draft(&storage, &name, &saved)?;
        let oversized = "界".repeat(MAX_DRAFT_BYTES / 3 + 1);
        assert_eq!(
            write_draft(
                &storage,
                &name,
                &draft(EditorLanguage::Python, "", &oversized)
            )
            .unwrap_err()
            .code,
            "draft_too_large"
        );
        assert_eq!(read_draft(&storage, &name)?, Some(saved));
        Ok(())
    }

    #[test]
    fn concurrent_writes_never_mix_the_two_language_drafts() -> Result<()> {
        let directory = tempfile::tempdir().unwrap();
        let storage = Storage::new(directory.path().to_owned());
        let name = file_name("sample:editor:1")?;
        std::thread::scope(|scope| {
            for index in 0..8 {
                let (storage, name) = (&storage, &name);
                scope.spawn(move || {
                    let code = index.to_string();
                    let draft = draft(EditorLanguage::Cpp, &code, &code);
                    write_draft(storage, name, &draft).unwrap();
                    let saved = read_draft(storage, name).unwrap().unwrap();
                    assert_eq!(saved.drafts.cpp, saved.drafts.python);
                });
            }
        });
        Ok(())
    }
}
