import { useId } from "react";
import { useMessages, type MessageKey } from "../../i18n";
import { debugTimeoutMessages } from "../../shared/debugDiagnostics";
import { Icon } from "../../shared/Icon";
import { isDebugActive, type DebugAction, type LocalDebug, type ProblemDebugLaunch } from "./localDebug";
import { ProblemDebugVariables } from "./ProblemDebugVariables";
import "./problem-debug.css";

const actionLabels = {
  continue: "problemDebugContinue",
  stepOver: "problemDebugStepOver",
  stepInto: "problemDebugStepInto",
  stepOut: "problemDebugStepOut",
} as const satisfies Record<DebugAction, MessageKey>;

const pauseActions = Object.keys(actionLabels) as DebugAction[];

const statusLabels = {
  starting: "problemDebugStarting",
  running: "problemDebugRunning",
  paused: "problemDebugPaused",
  finished: "problemDebugFinished",
  failed: "problemDebugFailed",
} as const satisfies Record<LocalDebug["status"], MessageKey>;

const errorLabels: Partial<Record<string, MessageKey>> = {
  tool_unavailable: "problemDebugToolUnavailable",
  debug_busy: "problemDebugBusy",
  debug_cancelled: "problemDebugCancelled",
  debug_timeout: "problemDebugTimeout",
  compile_failed: "problemDebugCompileFailed",
  invalid_request: "problemDebugInvalidRequest",
  output_limit: "problemRunOutputLimit",
};

const controlPaths = {
  stepOver: "M3 8a5 5 0 0 1 10 0m-3-2.5L13 8l2-2.5M8 10.5v2",
  stepInto: "M8 2v8m-3-3 3 3 3-3m-3 5.5v1",
  stepOut: "M8 10V2m-3 3 3-3 3 3m-3 7.5v1",
  stop: "M3.5 3.5h9v9h-9z",
} as const;

function ControlIcon({ action }: { action: DebugAction | "stop" }) {
  if (action === "continue") return <Icon name="run" size={14} />;
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true"
      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d={controlPaths[action]} />
    </svg>
  );
}

function sessionStatus(state: LocalDebug, messages: ReturnType<typeof useMessages>) {
  if (state.stopping) return messages.problemDebugStopping;
  if (state.inspecting && state.status === "paused") return messages.problemDebugInspecting;
  if (state.reason === "exception" && (state.status === "paused" || state.status === "finished")) return messages.problemDebugException;
  if (state.status !== "paused") return messages[statusLabels[state.status]];
  if (state.reason === "signal") return messages.problemDebugSignal;
  const line = state.frames?.[0]?.line || state.line;
  if (!line) return messages.problemDebugPaused;
  return (state.reason === "breakpoint" ? messages.problemDebugBreakpointHit : messages.problemDebugPausedAtLine).replace("{line}", String(line));
}

function DebugLaunch({ launch }: { launch?: ProblemDebugLaunch }) {
  const messages = useMessages();
  const description = useId();
  const message = launch ? launch.message : messages.problemDebugOpenProblem;
  return (
    <div className="problem-debug__launch">
      <button type="button" className="problem-debug__launch-button" disabled={!launch?.start || launch.disabled}
        aria-describedby={message ? description : undefined} onClick={launch?.start}>
        <Icon name="debug" size={15} /><span>{messages.problemDebugStart}</span>
      </button>
      {message && <p id={description} role="status">{message}</p>}
    </div>
  );
}

export function ProblemDebugPanel({ state, launch }: { state?: LocalDebug; launch?: ProblemDebugLaunch }) {
  const messages = useMessages();
  const titleId = useId();
  if (!state) return (
    <section className="problem-debug" aria-labelledby={titleId} data-status="idle">
      <header className="problem-debug__header"><h2 id={titleId}>{messages.problemDebugSidebar}</h2></header>
      <DebugLaunch launch={launch} />
    </section>
  );

  const { status, frames, variables, globalsReference, selectedFrame, inspecting, readingVariables, stopping,
    error, errorDetail, errorPhase } = state;
  const paused = status === "paused";
  const active = isDebugActive(state);
  const canLoadVariables = paused && !inspecting && !stopping;
  const canInspect = canLoadVariables && !readingVariables;
  const snapshotPending = status === "starting" || status === "running";
  const variableScope = `${state.sessionId}:${selectedFrame ?? 0}:${frames?.find(({ id }) => id === selectedFrame)?.name ?? ""}`;
  const errorKey = error && Object.hasOwn(errorLabels, error) ? errorLabels[error] : undefined;
  const errorText = error && messages[errorPhase ? debugTimeoutMessages[errorPhase] : errorKey ?? "problemDebugOperationFailed"];

  return (
    <section className="problem-debug" aria-labelledby={titleId} data-status={status}>
      <header className="problem-debug__header">
        <h2 id={titleId}>{messages.problemDebugSidebar}</h2>
        {active ? (
          <div className="problem-debug__actions" role="group" aria-label={messages.problemDebugControls}>
            {pauseActions.map((action) => (
              <button key={action} type="button" className="problem-debug__action"
                aria-label={messages[actionLabels[action]]} title={messages[actionLabels[action]]}
                aria-disabled={!canInspect || undefined} onClick={() => { if (canInspect) state.action(action); }}>
                <ControlIcon action={action} />
              </button>
            ))}
            <button type="button" className="problem-debug__action problem-debug__action--stop"
              aria-label={messages.problemDebugStop} title={messages.problemDebugStop}
              aria-disabled={stopping || undefined} onClick={() => { if (!stopping) state.action("stop"); }}>
              <ControlIcon action="stop" />
            </button>
          </div>
        ) : (
          <button type="button" className="problem-debug__action" aria-label={messages.problemDebugDismiss} title={messages.problemDebugDismiss}
            onClick={() => state.action("stop")}><Icon name="close" size={14} /></button>
        )}
      </header>
      <div className="problem-debug__status">
        <p role="status">{sessionStatus(state, messages)}</p>
        {active && (
          <button type="button" className="problem-debug__action" aria-label={messages.problemDebugShowSource}
            title={messages.problemDebugShowSource} onClick={state.reveal}><Icon name="editor" size={14} /></button>
        )}
      </div>
      {errorText && (
        <div className="problem-debug__error" role="alert" data-selectable>
          <p>{errorText}</p>
          {error !== "compile_failed" && errorDetail && errorDetail !== errorText && <pre>{errorDetail}</pre>}
        </div>
      )}
      {!active && launch && <DebugLaunch launch={launch} />}
      {/* Keep the last snapshot visible while the debugger fetches new values. */}
      {active && (
        <>
          <section className="problem-debug__section" aria-busy={snapshotPending || inspecting || undefined}>
            <ProblemDebugVariables variables={variables} globalsReference={globalsReference} revision={state.variableRevision}
              scope={variableScope} canInspect={canLoadVariables}
              loadChildren={state.loadVariableChildren} />
          </section>
          <section className="problem-debug__section" aria-busy={snapshotPending || undefined}>
            <h3>{messages.problemDebugCallStack}</h3>
            <ol className="problem-debug__stack">
              {frames?.map(({ id, name, line }) => (
                <li key={id}>
                  <button type="button" className="problem-debug__frame" aria-current={id === (selectedFrame ?? frames[0].id)}
                    aria-disabled={!canInspect || undefined} onClick={() => { if (canInspect) state.selectFrame(id); }}
                    title={line > 0 ? `${name}:${line}` : name}>
                    <span>{name}</span>
                    {line > 0 && <span className="problem-debug__frame-line">{line}</span>}
                  </button>
                </li>
              ))}
            </ol>
            {frames?.length === 0 && <p className="problem-debug__empty">{messages.problemDebugNoFrames}</p>}
          </section>
        </>
      )}
    </section>
  );
}
