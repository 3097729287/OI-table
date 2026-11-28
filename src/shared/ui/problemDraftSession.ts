import type { ChangeDesc, ChangeSet, Text } from "@codemirror/state";
import { invoke } from "@tauri-apps/api/core";
import type { CodeLanguage } from "../codeLanguages";
import {
  flushAllProblemDrafts, flushProblemDraft, loadProblemDraft, problemDraftSaveStatus, queueProblemDraft, subscribeToProblemDraft,
  type DraftOperation,
} from "./problemDrafts";

type DraftDocument = { readonly doc: Text; readonly breakpoints: readonly number[] };
type LoadedDraft = { documents: Record<CodeLanguage, DraftDocument>; createChanges: typeof ChangeSet.of };
type ExternalPhase = "opening" | "active" | "closing" | "missing" | "tooLarge" | "openFailed" | "syncFailed" | "closeFailed";
type ExternalStatus = { language: CodeLanguage; phase: ExternalPhase };
type ExternalChange = { language: CodeLanguage; changes: ChangeSet; document: DraftDocument };
type DraftListener = (change?: ExternalChange) => void;
const sessions = new Map<string, ProblemDraftSession>();
let windowClosing = false;

export function isDraftWorkspaceClosing() { return windowClosing; }

export function checkpointProblemDrafts() {
  return invoke<void>("checkpoint_problem_drafts").catch(console.error);
}

export async function prepareDraftsForClose(): Promise<"ready" | "external" | "save"> {
  windowClosing = true;
  let ready = false;
  try {
    const refreshed = await Promise.all(Array.from(sessions.values(), (session) => session.refreshForClose()));
    if (refreshed.includes(false)) return "external";
    if (!await flushAllProblemDrafts()) return "save";
    await checkpointProblemDrafts();
    ready = await flushAllProblemDrafts();
    return ready ? "ready" : "save";
  } catch {
    return "save";
  } finally {
    if (!ready) windowClosing = false;
  }
}

function normalizeBreakpointLines(lines: readonly number[], lineCount: number) {
  return [...new Set(lines.filter((line) => Number.isInteger(line) && line >= 1 && line <= lineCount))]
    .sort((left, right) => left - right);
}

export function sameBreakpointLines(left: readonly number[], right: readonly number[]) {
  return left.length === right.length && left.every((line, index) => line === right[index]);
}

export function mapBreakpointLines(lines: readonly number[], before: Text, after: Text, changes: ChangeDesc) {
  return normalizeBreakpointLines(lines.flatMap((number) => {
    const { from, to } = before.line(number);
    // Drop a deleted line with its newline. Otherwise follow its original start through edits.
    const start = number < before.lines ? from : from - 1;
    const end = Math.min(to + 1, before.length);
    if (start >= 0 && changes.mapPos(start, -1) === changes.mapPos(end, 1)) return [];
    return [after.lineAt(changes.mapPos(from, 1)).number];
  }), after.lines);
}

function breakpointKey(problemId: string) { return `oi-table.problem-breakpoints.${problemId}`; }

function readBreakpoints(problemId: string) {
  try {
    return JSON.parse(localStorage.getItem(breakpointKey(problemId)) ?? "null") as Partial<Record<CodeLanguage, unknown>> | null;
  } catch {
    return null;
  }
}

function externalChange(before: string, after: string) {
  function lowSurrogateAt(value: string, offset: number) {
    const code = value.charCodeAt(offset);
    return code >= 0xdc00 && code <= 0xdfff;
  }

  let from = 0;
  let to = before.length;
  let end = after.length;
  while (from < to && from < end && before[from] === after[from]) from += 1;
  if (from > 0 && (lowSurrogateAt(before, from) || lowSurrogateAt(after, from))) from -= 1;
  while (to > from && end > from && before[to - 1] === after[end - 1]) {
    to -= 1;
    end -= 1;
  }
  // The native journal accepts UTF-16 offsets only at Unicode character boundaries.
  if (lowSurrogateAt(before, to) || lowSurrogateAt(after, end)) {
    to += 1;
    end += 1;
  }
  return { from, to, insert: after.slice(from, end) };
}

function openExternalEdit(language: CodeLanguage, source: string, apply: (source: string, forceApply: boolean) => boolean,
  publish: (phase?: ExternalPhase, finished?: boolean) => void) {
  let pending: string | undefined;
  let timer: number | undefined;
  let reading: Promise<boolean> | undefined;
  let closing: Promise<boolean> | undefined;

  const opened = invoke<string>("open_external_editor", { language, source }).then((id) => {
    if (!closing) {
      publish("active");
      timer = window.setInterval(poll, 350);
      window.addEventListener("focus", poll);
      poll();
    }
    return id;
  }, (error: unknown) => {
    if (!closing) publish(error === "external_editor_vscode_missing" ? "missing"
      : error === "external_editor_source_too_large" ? "tooLarge" : "openFailed", true);
    return undefined;
  });

  async function read(finish: boolean, forceApply: boolean) {
    const sessionId = await opened;
    if (sessionId === undefined) return true;
    try {
      pending = await invoke<string | null>("read_external_editor", { sessionId, finish }) ?? pending;
      const synchronized = pending === undefined || apply(pending, forceApply);
      if (synchronized) pending = undefined;
      if (!closing) publish("active");
      return synchronized;
    } catch {
      if (!closing) publish("syncFailed");
      return false;
    }
  }

  function enqueueRead(finish = false, forceApply = finish) {
    // Explicit requests read again after any already-started poll.
    const next = Promise.resolve(reading).then(() => read(finish, forceApply));
    reading = next;
    void next.then(() => { if (reading === next) reading = undefined; });
    return next;
  }

  function poll() {
    if (!closing && !reading) void enqueueRead();
  }

  return {
    language,
    refresh: (forceApply = false) => closing ?? enqueueRead(false, forceApply),
    close() {
      if (closing) return closing;
      window.clearInterval(timer);
      window.removeEventListener("focus", poll);
      closing = enqueueRead(true).then((saved) => {
        publish(saved ? undefined : "closeFailed", true);
        return saved;
      });
      publish("closing");
      return closing;
    },
  };
}

export class ProblemDraftSession {
  #loaded?: LoadedDraft;
  #listeners = new Set<DraftListener>();
  #loading?: Promise<void>;
  #debugging = false;
  #external?: ReturnType<typeof openExternalEdit>;
  #externalStatus?: ExternalStatus;
  #owners = 0;
  #unsubscribeSave?: () => void;
  #retiring?: Promise<boolean>;

  private constructor(readonly problemId: string) {}

  static acquire(problemId: string) {
    const draft = sessions.get(problemId) ?? new ProblemDraftSession(problemId);
    sessions.set(problemId, draft);
    return { draft, dispose: draft.#retain() };
  }

  #retain() {
    if (this.#owners++ === 0) this.#unsubscribeSave = subscribeToProblemDraft(this.problemId, () => this.#publish());
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      if (--this.#owners !== 0) return;
      this.#unsubscribeSave?.();
      const retiring = this.#retiring = this.#external?.close() ?? Promise.resolve(true);
      void retiring.then(async () => {
        await this.#loading?.catch(() => {});
        await this.flush();
        if (this.#retiring !== retiring) return;
        this.#retiring = undefined;
        if (this.#owners === 0) sessions.delete(this.problemId);
      });
    };
  }

  load(): Promise<void> {
    return this.#retiring ? this.#retiring.then(() => this.#loadOnce()) : this.#loadOnce();
  }

  #loadOnce() {
    // The registry keeps one loader per problem alive through retirement.
    return this.#loading ??= (async () => {
      const [saved, { ChangeSet, Text }] = await Promise.all([loadProblemDraft(this.problemId), import("@codemirror/state")]);
      const breakpoints = readBreakpoints(this.problemId);
      function document(language: CodeLanguage): DraftDocument {
        const doc = Text.of((saved?.drafts[language] ?? "").split(/\r\n?|\n/));
        const lines = breakpoints?.[language];
        return { doc, breakpoints: Array.isArray(lines) ? normalizeBreakpointLines(lines, doc.lines) : [] };
      }
      this.#loaded = { documents: { cpp: document("cpp"), python: document("python") }, createChanges: ChangeSet.of };
    })().catch((error) => {
      this.#loading = undefined;
      throw error;
    });
  }

  subscribe = (listener: DraftListener) => {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  };

  #publish(change?: ExternalChange) {
    for (const listener of this.#listeners) listener(change);
  }

  get #data() {
    if (!this.#loaded) throw new Error("The draft has not been loaded");
    return this.#loaded;
  }

  document(language: CodeLanguage) { return this.#data.documents[language]; }
  getExternalStatus = () => this.#externalStatus;
  getSaveStatus = () => problemDraftSaveStatus(this.problemId);
  flush() { return flushProblemDraft(this.problemId); }
  setDebugging(debugging: boolean) { this.#debugging = debugging; }

  #setExternalStatus(language: CodeLanguage, phase?: ExternalPhase) {
    if (this.#externalStatus?.phase === phase) return;
    this.#externalStatus = phase ? { language, phase } : undefined;
    this.#publish();
  }

  #queue(change: DraftOperation) {
    const { cpp, python } = this.#data.documents;
    queueProblemDraft(this.problemId, change, () => ({
      language: change.language,
      drafts: { cpp: cpp.doc.toString(), python: python.doc.toString() },
    }));
  }

  selectLanguage(language: CodeLanguage) { this.#queue({ kind: "language", language }); }

  #record(language: CodeLanguage, doc: Text, breakpoints: readonly number[], changes: ChangeSet, external = false) {
    const { documents } = this.#data;
    const current = documents[language];
    const breakpointChanged = !sameBreakpointLines(current.breakpoints, breakpoints);
    if (changes.empty && !breakpointChanged) return;
    const document = { doc: changes.empty ? current.doc : doc, breakpoints };
    documents[language] = document;
    if (!changes.empty) this.#queue({ kind: "edit", language, changes });
    if (breakpointChanged) {
      const { cpp, python } = documents;
      try {
        if (cpp.breakpoints.length || python.breakpoints.length) {
          localStorage.setItem(breakpointKey(this.problemId), JSON.stringify({ cpp: cpp.breakpoints, python: python.breakpoints }));
        } else localStorage.removeItem(breakpointKey(this.problemId));
      } catch {
        // The session still retains the breakpoints when storage is unavailable.
      }
    }
    this.#publish(external ? { language, changes, document } : undefined);
  }

  recordEditorUpdate(language: CodeLanguage, doc: Text, changes: ChangeSet, breakpoints: readonly number[]) {
    this.#record(language, doc, breakpoints, changes);
  }

  #applyExternal(language: CodeLanguage, source: string, forceApply: boolean) {
    if (this.#debugging && !forceApply) return false;
    const current = this.document(language);
    const before = current.doc.toString();
    if (before === source) return true;
    const changes = this.#data.createChanges(externalChange(before, source), current.doc.length);
    const doc = changes.apply(current.doc);
    this.#record(language, doc, mapBreakpointLines(current.breakpoints, current.doc, doc, changes), changes, true);
    return true;
  }

  toggleExternal(language: CodeLanguage) {
    if (windowClosing || this.#debugging || this.#externalStatus?.phase === "opening" || this.#externalStatus?.phase === "closing") return;
    if (this.#external) { void this.#external.close(); return; }

    this.#external = openExternalEdit(language, this.document(language).doc.toString(),
      (source, forceApply) => this.#applyExternal(language, source, forceApply),
      (phase, finished) => {
        if (finished) this.#external = undefined;
        this.#setExternalStatus(language, phase);
      });
    this.#setExternalStatus(language, "opening");
  }

  refreshForClose() { return this.#external?.refresh(true) ?? this.#retiring ?? true; }

  async prepareForLaunch(language: CodeLanguage) {
    await this.load();
    const external = this.#external;
    if (external?.language === language && !await external.refresh()) throw new Error("Could not read the external draft");
    const { doc, breakpoints } = this.document(language);
    return { language, source: doc.toString(), breakpoints, readBreakpoints: () => {
      const current = this.document(language);
      return current.doc === doc ? current.breakpoints : breakpoints;
    } };
  }
}
