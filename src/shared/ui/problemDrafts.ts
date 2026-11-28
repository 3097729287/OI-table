import type { ChangeSet } from "@codemirror/state";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { CodeLanguage } from "../codeLanguages";

export interface ProblemDraft {
  language?: CodeLanguage;
  drafts: Record<CodeLanguage, string>;
}

export type DraftOperation =
  | { kind: "edit"; language: CodeLanguage; changes: ChangeSet }
  | { kind: "language"; language: CodeLanguage };

type Restore = { kind: "restore"; draft: ProblemDraft };
type Replacement = { from: number; to: number; insert: string };
type DraftChange =
  | { kind: "edit"; language: CodeLanguage; changes: Replacement[] }
  | Extract<DraftOperation, { kind: "language" }>
  | Restore;

type NativeDraft = ProblemDraft & { revision: number };
type DraftBatch = { id: string; baseRevision: number; changes: DraftChange[] };
type DraftVersion = { revision: number; language?: CodeLanguage };
type Operations = {
  edits: Partial<Record<CodeLanguage, ChangeSet>>;
  language?: CodeLanguage;
  restore?: Restore;
};
type SaveStatus = "saved" | "saving" | "failed";
type PendingSave = {
  getDraft: () => ProblemDraft;
  latestLanguage?: CodeLanguage;
  next: Operations;
  batch?: { request: DraftBatch; language?: CodeLanguage };
  timer?: number;
  writing?: Promise<boolean>;
  failed: boolean;
  needsSnapshot: boolean;
  legacyJournal?: string;
};

const delay = 2_000;
const appendTimeout = 10_000;
const pending = new Map<string, PendingSave>();
const versions = new Map<string, DraftVersion>();
const reads = new Map<string, Promise<ProblemDraft | null>>();
const changes = new EventTarget();
const externalDrafts = new Map<string, { language: CodeLanguage; refresh: (forceApply: boolean) => Promise<boolean> }>();

export function registerExternalDraft(problemId: string, language: CodeLanguage, refresh: (forceApply: boolean) => Promise<boolean>) {
  const draft = { language, refresh };
  externalDrafts.set(problemId, draft);
  return () => {
    if (externalDrafts.get(problemId) === draft) externalDrafts.delete(problemId);
  };
}

export function refreshExternalDraft(problemId: string, language: CodeLanguage) {
  const draft = externalDrafts.get(problemId);
  return draft?.language === language ? draft.refresh(false) : undefined;
}

export async function refreshExternalDraftsBeforeExit() {
  const results = await Promise.all([...externalDrafts.values()].map(({ refresh }) => refresh(true)));
  return results.every(Boolean);
}

function storageKey(problemId: string) {
  return `oi-table.problem-draft.${problemId}`;
}

function readJournal(problemId: string) {
  try {
    const stored = localStorage.getItem(storageKey(problemId));
    if (!stored) return null;
    const draft = JSON.parse(stored) as Partial<ProblemDraft> | null;
    if (typeof draft?.drafts?.cpp === "string" && typeof draft.drafts.python === "string") {
      const language = draft.language === "cpp" || draft.language === "python" ? draft.language : undefined;
      return { stored, draft: { language, drafts: draft.drafts } };
    }
  } catch {
    // Storage can be unavailable in a browser; the desktop store still works.
  }
  return null;
}

function removeJournal(problemId: string, stored: string) {
  try {
    const key = storageKey(problemId);
    if (localStorage.getItem(key) === stored) localStorage.removeItem(key);
  } catch {
    // The native recovery log already contains the draft.
  }
}

async function loadNativeDraft(problemId: string): Promise<ProblemDraft | null> {
  const previousRevision = versions.get(problemId)?.revision;
  const saved = await invoke<NativeDraft | null>("get_problem_draft", { problemId });
  const queued = pending.get(problemId);
  if (queued) return queued.getDraft();

  const revision = saved?.revision ?? 0;
  const latestRevision = versions.get(problemId)?.revision;
  if (latestRevision !== undefined && latestRevision !== previousRevision && latestRevision > revision) {
    // A batch finished while this read was in flight.
    return loadNativeDraft(problemId);
  }
  versions.set(problemId, { revision, language: saved?.language });

  const journal = readJournal(problemId);
  if (journal) {
    if (revision > 0) removeJournal(problemId, journal.stored);
    else {
      const save = queueChange(problemId, { kind: "restore", draft: journal.draft }, () => journal.draft);
      save.legacyJournal = journal.stored;
      return journal.draft;
    }
  }
  return saved && { language: saved.language, drafts: saved.drafts };
}

export async function loadProblemDraft(problemId: string): Promise<ProblemDraft | null> {
  const queued = pending.get(problemId);
  if (queued) return queued.getDraft();
  if (!isTauri()) {
    const draft = readJournal(problemId)?.draft ?? null;
    versions.set(problemId, { revision: 0, language: draft?.language });
    return draft;
  }

  let request = reads.get(problemId);
  if (!request) {
    request = loadNativeDraft(problemId).finally(() => reads.delete(problemId));
    reads.set(problemId, request);
  }
  const saved = await request;
  return pending.get(problemId)?.getDraft() ?? saved;
}

export async function loadProblemDraftForExecution(problemId: string, language: CodeLanguage) {
  if (await refreshExternalDraft(problemId, language) === false) throw new Error("Could not read the external draft");
  return loadProblemDraft(problemId);
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

function scheduleWrite(problemId: string, save: PendingSave, milliseconds = delay) {
  if (save.timer === undefined) {
    save.timer = window.setTimeout(() => {
      save.timer = undefined;
      void writeBatch(problemId, save);
    }, milliseconds);
  }
}

function stopTimer(save: PendingSave) {
  window.clearTimeout(save.timer);
  save.timer = undefined;
}

function queueChange(problemId: string, change: DraftOperation | Restore, getDraft: () => ProblemDraft): PendingSave {
  const existing = pending.get(problemId);
  const save: PendingSave = existing ?? { getDraft, next: { edits: {} }, failed: false, needsSnapshot: false };
  save.getDraft = getDraft;
  if (change.kind === "restore") {
    save.latestLanguage = change.draft.language;
    save.next = { edits: {}, restore: change };
  } else {
    const { language } = change;
    save.latestLanguage = language;
    save.next.language = language;
    if (change.kind === "edit") {
      const previous = save.next.edits[language];
      const combined = previous ? previous.compose(change.changes) : change.changes;
      if (combined.empty) delete save.next.edits[language];
      else save.next.edits[language] = combined;
    }
  }
  pending.set(problemId, save);
  scheduleWrite(problemId, save);
  if (!existing) notify(problemId);
  return save;
}

export function queueProblemDraft(problemId: string, change: DraftOperation, getDraft: () => ProblemDraft) {
  const save = pending.get(problemId);
  const language = save ? save.latestLanguage : versions.get(problemId)?.language;
  if (change.kind === "language" && change.language === language) return;
  queueChange(problemId, change, getDraft);
}

function serializeChanges(save: PendingSave, baseLanguage: CodeLanguage | undefined): {
  changes: DraftChange[]; language?: CodeLanguage;
} {
  if (save.needsSnapshot) {
    const draft = save.getDraft();
    return { changes: [{ kind: "restore", draft: { language: draft.language, drafts: { ...draft.drafts } } }],
      language: draft.language };
  }

  const { edits, language, restore } = save.next;
  const changes: DraftChange[] = restore ? [restore] : [];
  let storedLanguage = restore ? restore.draft.language : baseLanguage;
  // Each edit also records its language. Put the requested final language last where possible.
  const order: readonly CodeLanguage[] = language === "cpp" ? ["python", "cpp"] : ["cpp", "python"];
  for (const current of order) {
    const replacements: Replacement[] = [];
    edits[current]?.iterChanges((from, to, _newFrom, _newTo, inserted) => {
      replacements.push({ from, to, insert: inserted.toString() });
    });
    if (replacements.length) {
      changes.push({ kind: "edit", language: current, changes: replacements });
      storedLanguage = current;
    }
  }
  if (language !== undefined && language !== storedLanguage) {
    changes.push({ kind: "language", language });
    storedLanguage = language;
  }
  return { changes, language: storedLanguage };
}

function pendingBatch(problemId: string, save: PendingSave) {
  if (save.batch) return save.batch;
  const version = versions.get(problemId);
  if (version === undefined) throw new Error("The draft must be loaded before editing");
  const { changes, language } = serializeChanges(save, version.language);
  if (changes.length) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    save.batch = { request: { id, baseRevision: version.revision, changes }, language };
  }
  save.next = { edits: {} };
  save.needsSnapshot = false;
  return save.batch;
}

async function appendBatch(problemId: string, batch: DraftBatch) {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error("Draft append timed out")), appendTimeout);
  });

  try {
    return await Promise.race([invoke<number>("append_problem_draft", { problemId, batch }), timeout]);
  } finally {
    window.clearTimeout(timer);
  }
}

function rejectedForSize(error: unknown) {
  return error !== null && typeof error === "object" && "code" in error &&
    (error.code === "draft_too_large" || error.code === "draft_batch_too_large");
}

function writeBatch(problemId: string, save: PendingSave): Promise<boolean> {
  if (save.writing) return save.writing;
  stopTimer(save);
  save.writing = Promise.resolve().then(async () => {
    if (save.failed) {
      save.failed = false;
      notify(problemId);
    }
    let retryUpdatedSnapshot = false;
    try {
      if (isTauri()) {
        const batch = pendingBatch(problemId, save);
        if (batch) {
          const revision = await appendBatch(problemId, batch.request);
          versions.set(problemId, { revision, language: batch.language });
          save.batch = undefined;
          if (save.legacyJournal !== undefined) {
            removeJournal(problemId, save.legacyJournal);
            save.legacyJournal = undefined;
          }
        }
      } else {
        const { edits, language } = save.next;
        if (edits.cpp || edits.python || language !== versions.get(problemId)?.language) {
          const draft = save.getDraft();
          localStorage.setItem(storageKey(problemId), JSON.stringify(draft));
          versions.set(problemId, { revision: 0, language: draft.language });
        }
        save.next = { edits: {} };
      }
    } catch (error) {
      if (rejectedForSize(error)) {
        // This batch was never committed. A newer snapshot can omit its oversized content.
        retryUpdatedSnapshot = save.next.language !== undefined;
        save.batch = undefined;
        save.next = { edits: {} };
        save.needsSnapshot = true;
      }
      save.failed = true;
    }

    save.writing = undefined;
    if (save.failed) {
      stopTimer(save);
      if (retryUpdatedSnapshot) scheduleWrite(problemId, save);
      notify(problemId);
    } else if (save.next.language === undefined) {
      stopTimer(save);
      pending.delete(problemId);
      notify(problemId);
    } else {
      // The timer may have elapsed while a previous append was in flight.
      scheduleWrite(problemId, save, 0);
    }
    return !save.failed;
  });
  return save.writing;
}

export async function flushProblemDraft(problemId: string): Promise<boolean> {
  let save = pending.get(problemId);
  while (save) {
    if (!await writeBatch(problemId, save)) return false;
    save = pending.get(problemId);
  }
  return true;
}

export async function flushAllProblemDrafts(): Promise<boolean> {
  while (pending.size) {
    const results = await Promise.all([...pending.keys()].map(flushProblemDraft));
    if (results.includes(false)) return false;
  }
  return true;
}
