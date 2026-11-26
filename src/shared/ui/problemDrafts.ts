import { invoke, isTauri } from "@tauri-apps/api/core";
import type { CodeLanguage } from "../codeLanguages";

export interface ProblemDraft {
  language?: CodeLanguage;
  drafts: Record<CodeLanguage, string>;
}

type SaveStatus = "saved" | "saving" | "failed";
type PendingSave = { draft: ProblemDraft; timer?: number; writing: boolean; failed: boolean };

const delay = 350;
const pending = new Map<string, PendingSave>();
const changes = new EventTarget();

function storageKey(problemId: string) {
  return `oi-table.problem-draft.${problemId}`;
}

function readJournal(problemId: string): ProblemDraft | null {
  try {
    const stored = localStorage.getItem(storageKey(problemId));
    if (!stored) return null;
    const draft = JSON.parse(stored) as Partial<ProblemDraft> | null;
    if (typeof draft?.drafts?.cpp === "string" && typeof draft.drafts.python === "string") {
      const language = draft.language === "cpp" || draft.language === "python" ? draft.language : undefined;
      return { language, drafts: draft.drafts };
    }
  } catch {
    // Storage can be unavailable in a browser; the desktop store still works.
  }
  return null;
}

function writeJournal(problemId: string, draft: ProblemDraft) {
  localStorage.setItem(storageKey(problemId), JSON.stringify(draft));
}

export async function loadProblemDraft(problemId: string): Promise<ProblemDraft | null> {
  const scheduled = pending.get(problemId);
  if (scheduled) return scheduled.draft;

  const journal = readJournal(problemId);
  if (journal) {
    if (isTauri()) queueProblemDraft(problemId, journal);
    return journal;
  }
  if (!isTauri()) return null;
  const saved = await invoke<ProblemDraft | null>("get_problem_draft", { problemId });
  return pending.get(problemId)?.draft ?? saved;
}

export function subscribeToProblemDraft(problemId: string, listener: () => void) {
  changes.addEventListener(problemId, listener);
  return () => changes.removeEventListener(problemId, listener);
}

export function problemDraftSaveStatus(problemId: string): SaveStatus {
  const save = pending.get(problemId);
  if (!save) return "saved";
  return save.failed ? "failed" : "saving";
}

function notify(problemId: string) {
  changes.dispatchEvent(new Event(problemId));
}

export function queueProblemDraft(problemId: string, draft: ProblemDraft) {
  const save: PendingSave = pending.get(problemId) ?? { draft, writing: false, failed: false };
  save.draft = draft;
  save.failed = false;
  pending.set(problemId, save);

  // Keep edits recoverable even if the window closes before the native write finishes.
  try { writeJournal(problemId, draft); } catch { /* Native saving can still succeed. */ }
  if (!save.writing) {
    window.clearTimeout(save.timer);
    save.timer = window.setTimeout(() => void flushProblemDraft(problemId), delay);
  }
  notify(problemId);
}

export async function flushProblemDraft(problemId: string) {
  const save = pending.get(problemId);
  if (!save || save.writing) return;
  window.clearTimeout(save.timer);
  save.timer = undefined;
  save.writing = true;
  save.failed = false;
  const draft = save.draft;
  const native = isTauri();
  notify(problemId);

  try {
    if (native) await invoke<void>("save_problem_draft", { problemId, draft });
    else writeJournal(problemId, draft);

    if (save.draft === draft) {
      pending.delete(problemId);
      if (native) {
        try { localStorage.removeItem(storageKey(problemId)); } catch { /* The native write completed. */ }
      }
    }
  } catch {
    if (save.draft === draft) save.failed = true;
  } finally {
    save.writing = false;
    notify(problemId);
    // Keep one native write per problem in flight so slower writes cannot replace newer edits.
    if (save.draft !== draft) void flushProblemDraft(problemId);
  }
}
