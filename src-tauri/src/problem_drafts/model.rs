use std::{borrow::Cow, iter::Peekable, str::CharIndices};

use serde::{Deserialize, Serialize};

use crate::editor_run::EditorLanguage;

use super::{ProblemDraftError, Result, MAX_DRAFT_BYTES, MAX_SAFE_INTEGER};

const MAX_BATCH_OPERATIONS: usize = 4_096;
const MAX_BATCH_RANGES: usize = 65_536;
const MAX_BATCH_TEXT_BYTES: usize = 8 * MAX_DRAFT_BYTES;

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub(super) struct ProblemDraft {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) language: Option<EditorLanguage>,
    pub(super) drafts: DraftContents,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct DraftContents {
    pub(super) cpp: String,
    pub(super) python: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct VersionedDraft {
    pub(super) revision: u64,
    #[serde(flatten)]
    pub(super) draft: ProblemDraft,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DraftBatch {
    pub(super) id: String,
    pub(super) base_revision: u64,
    pub(super) changes: Vec<DraftChange>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub(super) enum DraftChange {
    Edit {
        language: EditorLanguage,
        changes: Vec<Replacement>,
    },
    Language {
        language: EditorLanguage,
    },
    Restore {
        draft: ProblemDraft,
    },
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Replacement {
    from: usize,
    to: usize,
    insert: String,
}

fn invalid_batch() -> ProblemDraftError {
    ProblemDraftError::new("invalid_draft_batch", "Invalid problem draft changes")
}

pub(super) fn batch_too_large() -> ProblemDraftError {
    ProblemDraftError::new(
        "draft_batch_too_large",
        "Too many changes in the problem draft batch",
    )
}

impl DraftBatch {
    pub(super) fn next_revision(&self) -> Result<u64> {
        if self.id.is_empty()
            || self.id.len() > 128
            || self.id.chars().any(char::is_control)
            || self.base_revision >= MAX_SAFE_INTEGER
            || self.changes.is_empty()
        {
            return Err(invalid_batch());
        }
        Ok(self.base_revision + 1)
    }

    pub(super) fn apply(&self, mut draft: ProblemDraft) -> Result<ProblemDraft> {
        if self.changes.len() > MAX_BATCH_OPERATIONS {
            return Err(batch_too_large());
        }
        let mut inserted_bytes = 0usize;
        let mut ranges = 0usize;
        for change in &self.changes {
            match change {
                DraftChange::Edit { changes, .. } => {
                    if changes.is_empty() {
                        return Err(invalid_batch());
                    }
                    ranges = ranges.saturating_add(changes.len());
                    for change in changes {
                        inserted_bytes = inserted_bytes.saturating_add(change.insert.len());
                    }
                }
                DraftChange::Restore { draft } => {
                    inserted_bytes = inserted_bytes
                        .saturating_add(draft.drafts.cpp.len())
                        .saturating_add(draft.drafts.python.len());
                }
                DraftChange::Language { .. } => {}
            }
            if ranges > MAX_BATCH_RANGES || inserted_bytes > MAX_BATCH_TEXT_BYTES {
                return Err(batch_too_large());
            }
        }

        for change in &self.changes {
            match change {
                DraftChange::Edit { language, changes } => {
                    let source = match language {
                        EditorLanguage::Cpp => &mut draft.drafts.cpp,
                        EditorLanguage::Python => &mut draft.drafts.python,
                    };
                    *source = apply_edit(source, changes)?;
                    draft.language = Some(*language);
                }
                DraftChange::Language { language } => draft.language = Some(*language),
                DraftChange::Restore { draft: restored } => draft = restored.clone(),
            }
        }

        if draft.drafts.cpp.len() > MAX_DRAFT_BYTES || draft.drafts.python.len() > MAX_DRAFT_BYTES {
            return Err(ProblemDraftError::new(
                "draft_too_large",
                "A draft can contain up to 1 MiB of code per language",
            ));
        }
        Ok(draft)
    }
}

fn normalize_lines(source: &str) -> Cow<'_, str> {
    if source.contains('\r') {
        Cow::Owned(source.replace("\r\n", "\n").replace('\r', "\n"))
    } else {
        Cow::Borrowed(source)
    }
}

fn advance_to_offset(
    source: &str,
    characters: &mut Peekable<CharIndices<'_>>,
    offset: &mut usize,
    target: usize,
) -> Result<usize> {
    while *offset < target {
        let (_, character) = characters.next().ok_or_else(invalid_batch)?;
        *offset += character.len_utf16();
    }
    if *offset != target {
        return Err(invalid_batch());
    }
    Ok(characters.peek().map_or(source.len(), |(index, _)| *index))
}

fn apply_edit(source: &str, edits: &[Replacement]) -> Result<String> {
    let source = normalize_lines(source);
    let mut code = String::with_capacity(source.len());
    let mut characters = source.char_indices().peekable();
    let mut offset = 0;
    let mut previous_end = 0;
    for edit in edits {
        if edit.from > edit.to {
            return Err(invalid_batch());
        }
        let start = advance_to_offset(&source, &mut characters, &mut offset, edit.from)?;
        let end = advance_to_offset(&source, &mut characters, &mut offset, edit.to)?;
        code.push_str(&source[previous_end..start]);
        code.push_str(&normalize_lines(&edit.insert));
        previous_end = end;
    }
    code.push_str(&source[previous_end..]);
    Ok(code)
}
