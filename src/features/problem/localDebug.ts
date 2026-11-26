import { invoke } from "@tauri-apps/api/core";
import { createContext, useCallback, useEffect, useRef, useState } from "react";
import { debugTimeoutMessages, type DebugTimeoutPhase } from "../../shared/debugDiagnostics";
import type { CodeLanguage } from "../../shared/ui/codeLanguages";

export type DebugAction = "continue" | "stepOver" | "stepInto" | "stepOut";

export interface DebugFrame {
  id: number;
  name: string;
  line: number;
}

export interface DebugVariable {
  name: string;
  value: string;
  type: string;
  reference?: number;
  group?: "special" | "function" | "class";
  previous?: { value: string; type: string };
}

interface DebugFrameVariables {
  variables: readonly DebugVariable[];
  globalsReference?: number;
}

interface DebugSnapshot extends DebugFrameVariables {
  sessionId: number;
  status: "paused" | "finished";
  reason: string;
  line: number | null;
  frames: DebugFrame[];
  stdout: string;
  stderr: string;
}

interface DebugSession {
  sessionId: number;
  problemId: string;
  language: CodeLanguage;
  status: "starting" | "running" | "paused" | "finished" | "failed";
  revealKey: number;
  sourceRevealKey?: number;
  variableRevision: number;
  reason?: string;
  line?: number | null;
  frames?: readonly DebugFrame[];
  variables?: readonly DebugVariable[];
  globalsReference?: number;
  selectedFrame?: number;
  error?: string;
  errorDetail?: string;
  errorPhase?: DebugTimeoutPhase;
  stdout?: string;
  stderr?: string;
  inspecting?: boolean;
  readingVariables?: boolean;
  stopping?: boolean;
}

interface VariableRequests {
  sessionId: number;
  revision: number;
  tail: Promise<void>;
  pending: Map<number, Promise<readonly DebugVariable[]>>;
}

export interface LocalDebug extends DebugSession {
  action(action: DebugAction | "stop"): void;
  selectFrame(id: number): void;
  reveal(): void;
  loadVariableChildren(reference: number): Promise<readonly DebugVariable[]>;
}

interface DebugWorkspace {
  state?: LocalDebug;
  start(problemId: string, language: CodeLanguage, source: string, stdin: string, breakpoints: number[]): void;
  setBreakpoints(problemId: string, language: CodeLanguage, breakpoints: number[]): void;
  release(problemId: string): void;
}

export interface ProblemDebugLaunch {
  start?: () => void;
  disabled?: boolean;
  message?: string;
}

export const ProblemDebugContext = createContext<(DebugWorkspace & {
  activeProblemId?: string;
  launch?: ProblemDebugLaunch;
  registerLaunch(problemId: string, launch: ProblemDebugLaunch): () => void;
}) | null>(null);

export function isDebugActive(session?: DebugSession) {
  return session !== undefined && session.status !== "finished" && session.status !== "failed";
}

function debugError(error: unknown): Pick<DebugSession, "error" | "errorDetail" | "errorPhase"> {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return {
      error: error.code,
      errorDetail: "message" in error && typeof error.message === "string" ? error.message : undefined,
      errorPhase: "phase" in error && typeof error.phase === "string" && Object.hasOwn(debugTimeoutMessages, error.phase)
        ? error.phase as DebugTimeoutPhase : undefined,
    };
  }
  return { error: "debug_failed", errorDetail: typeof error === "string" ? error : undefined, errorPhase: undefined };
}

let nextSessionId = Date.now();

export function useLocalDebug(onStart: () => void, onReveal: (problemId: string) => void): DebugWorkspace {
  const active = useRef<DebugSession | undefined>(undefined);
  const breakpoints = useRef<number[]>([]);
  const variableRequests = useRef<VariableRequests | undefined>(undefined);
  const [session, setSession] = useState<DebugSession>();

  const replace = useCallback((next?: DebugSession) => {
    active.current = next;
    setSession(next);
  }, []);

  const release = useCallback((problemId: string) => {
    const current = active.current;
    if (!current || current.problemId !== problemId) return;
    replace();
    if (isDebugActive(current)) void invoke("debug_stop", { sessionId: current.sessionId }).catch(() => {});
  }, [replace]);

  useEffect(() => () => {
    const current = active.current;
    active.current = undefined;
    if (current && isDebugActive(current)) void invoke("debug_stop", { sessionId: current.sessionId }).catch(() => {});
  }, []);

  function complete(sessionId: number, snapshot: DebugSnapshot) {
    const current = active.current;
    if (!current || current.sessionId !== sessionId) {
      if (snapshot.status === "paused") void invoke("debug_stop", { sessionId }).catch(() => {});
      return;
    }
    if (current.stopping) return;
    const paused = snapshot.status === "paused";
    replace({
      ...current,
      ...snapshot,
      line: snapshot.line ?? snapshot.frames[0]?.line ?? null,
      globalsReference: snapshot.globalsReference,
      selectedFrame: snapshot.frames[0]?.id,
      revealKey: current.revealKey + Number(paused),
      variableRevision: current.variableRevision + Number(paused),
    });
    if (paused) onReveal(current.problemId);
  }

  const fail = useCallback((sessionId: number, error: unknown) => {
    const current = active.current;
    if (!current || current.sessionId !== sessionId || current.stopping) return;
    replace({ ...current, ...debugError(error), status: "failed", line: null, frames: [], variables: [], globalsReference: undefined });
    void invoke("debug_stop", { sessionId }).catch(() => {});
  }, [replace]);

  async function runCommand(sessionId: number, command: () => Promise<DebugSnapshot>) {
    try {
      complete(sessionId, await command());
    } catch (error) {
      fail(sessionId, error);
    }
  }

  function start(problemId: string, language: CodeLanguage, source: string, stdin: string, lines: number[]) {
    if (isDebugActive(active.current)) return;
    const sessionId = ++nextSessionId;
    breakpoints.current = lines;
    replace({ sessionId, problemId, language, status: "starting", revealKey: 0, variableRevision: 0 });
    onStart();
    void runCommand(sessionId, () => invoke<DebugSnapshot>("debug_start", {
      request: { sessionId, language, source, stdin, breakpoints: lines },
    }));
  }

  function setBreakpoints(problemId: string, language: CodeLanguage, lines: number[]) {
    const current = active.current;
    if (current?.problemId === problemId && current.language === language) breakpoints.current = lines;
  }

  async function stop(current: DebugSession) {
    if (current.stopping) return;
    if (!isDebugActive(current)) {
      replace();
      return;
    }
    const { sessionId } = current;
    replace({ ...current, stopping: true });
    try {
      await invoke("debug_stop", { sessionId });
      if (active.current?.sessionId === sessionId) replace();
    } catch (error) {
      const pending = active.current;
      if (pending?.sessionId === sessionId) replace({ ...pending, ...debugError(error), stopping: false });
    }
  }

  function action(action: DebugAction | "stop") {
    const current = active.current;
    if (!current) return;
    if (action === "stop") {
      void stop(current);
      return;
    }
    if (current.status !== "paused" || current.inspecting || current.readingVariables || current.stopping) return;
    const { sessionId } = current;
    replace({ ...current, status: "running", line: null, error: undefined, errorDetail: undefined, errorPhase: undefined });
    void runCommand(sessionId, () => invoke<DebugSnapshot>("debug_step", {
      request: { sessionId, action, breakpoints: breakpoints.current },
    }));
  }

  function reveal() {
    const current = active.current;
    if (!current) return;
    const revealKey = current.revealKey + 1;
    replace({ ...current, revealKey, sourceRevealKey: revealKey });
    onReveal(current.problemId);
  }

  async function selectFrame(frameId: number) {
    const current = active.current;
    if (!current || current.status !== "paused" || current.inspecting || current.readingVariables || current.stopping) return;
    const frame = current.frames?.find(({ id }) => id === frameId);
    if (!frame) return;
    if (current.selectedFrame === frameId) {
      reveal();
      return;
    }
    const { sessionId } = current;
    replace({ ...current, inspecting: true, error: undefined, errorDetail: undefined, errorPhase: undefined });
    try {
      const { variables, globalsReference } = await invoke<DebugFrameVariables>("debug_inspect", { request: { sessionId, frameId } });
      const pending = active.current;
      if (pending?.sessionId !== sessionId || pending.stopping) return;
      const revealKey = pending.revealKey + 1;
      replace({
        ...pending,
        inspecting: false,
        selectedFrame: frameId,
        line: frame.line,
        variables,
        globalsReference,
        revealKey,
        sourceRevealKey: revealKey,
        variableRevision: pending.variableRevision + 1,
      });
      onReveal(pending.problemId);
    } catch (error) {
      const pending = active.current;
      if (pending?.sessionId !== sessionId || pending.stopping) return;
      const failure = debugError(error);
      if (failure.error === "invalid_request" || failure.error === "debug_busy") {
        replace({ ...pending, ...failure, inspecting: false });
      } else fail(sessionId, error);
    }
  }

  const loadVariableChildren = useCallback((reference: number) => {
    const current = active.current;
    if (!current || current.status !== "paused" || current.inspecting || current.stopping) {
      return Promise.reject(new Error("Variable data is unavailable at this stop."));
    }
    const { sessionId, variableRevision } = current;
    let queue = variableRequests.current;
    if (queue?.sessionId !== sessionId || queue.revision !== variableRevision) {
      queue = { sessionId, revision: variableRevision, tail: Promise.resolve(), pending: new Map() };
      variableRequests.current = queue;
    }
    const existing = queue.pending.get(reference);
    if (existing) return existing;

    // The native debugger reads one variable object at a time while the program is paused.
    const pending = queue.pending;
    if (pending.size === 0) replace({ ...current, readingVariables: true });
    const result = queue.tail.then(() => {
      const latest = active.current;
      if (latest?.sessionId !== sessionId || latest.variableRevision !== variableRevision ||
          latest.status !== "paused" || latest.stopping) {
        throw new Error("Variable data is unavailable at this stop.");
      }
      return invoke<DebugVariable[]>("debug_variables", { request: { sessionId, reference } }).catch((error) => {
        const failure = debugError(error);
        if (failure.error !== "invalid_request" && failure.error !== "debug_busy") fail(sessionId, error);
        throw error;
      });
    }).finally(() => {
      pending.delete(reference);
      const latest = active.current;
      if (pending.size === 0 && latest?.sessionId === sessionId && latest.variableRevision === variableRevision) {
        replace({ ...latest, readingVariables: false });
      }
    });
    pending.set(reference, result);
    queue.tail = result.then(() => {}, () => {});
    return result;
  }, [fail, replace]);

  return { state: session && { ...session, action, selectFrame, reveal, loadVariableChildren }, start, setBreakpoints, release };
}
