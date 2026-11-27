import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { t, type MessageKey } from "../../../i18n";
import { debugTimeoutMessages } from "../../../shared/debugDiagnostics";
import { Icon, type IconName } from "../../../shared/Icon";
import { checkRunDebugEnvironment, type RunDebugProgress, type RunDebugReport } from "./runDebugDiagnostics";
import "./run-debug-settings.css";

const toolLabels = {
  cpp: "runDebugCompiler",
  python: "runDebugPython",
  gdb: "runDebugGdb",
} as const satisfies Record<RunDebugReport["tools"][number]["id"], MessageKey>;

const checkLabels = {
  cppRun: "runDebugCppRun",
  pythonRun: "runDebugPythonRun",
  cppDebug: "runDebugCppDebug",
  pythonDebug: "runDebugPythonDebug",
} as const satisfies Record<RunDebugReport["checks"][number]["id"], MessageKey>;

type Tool = RunDebugReport["tools"][number];
type HealthCheck = RunDebugReport["checks"][number];
type Status = Tool["status"] | RunDebugProgress["status"];

const toolIds = Object.keys(toolLabels) as Tool["id"][];
const checkIds = Object.keys(checkLabels) as HealthCheck["id"][];

const statusLabels = {
  checking: "runDebugChecking",
  ready: "runDebugReady",
  missing: "runDebugMissing",
  failed: "runDebugFailed",
  unchecked: "runDebugUnchecked",
  busy: "runDebugBusy",
} as const satisfies Record<Status, MessageKey>;

const statusIcons = {
  checking: "spinner",
  ready: "check",
  missing: "warning",
  failed: "close",
  unchecked: "pending",
  busy: "pending",
} as const satisfies Record<Status, IconName>;

interface CheckState {
  report?: RunDebugReport;
  checking?: "detect" | "test";
  progress?: Partial<Record<HealthCheck["id"], RunDebugProgress>>;
  failed?: boolean;
}

function DiagnosticDetail({ detail }: { detail?: string }) {
  if (!detail) return null;
  if (detail.length <= 160 && !/[\r\n]/.test(detail)) {
    return <p className="run-debug-settings__detail" data-selectable>{detail}</p>;
  }
  return (
    <details className="run-debug-settings__disclosure">
      <summary>{t("errorDetails")}</summary>
      <p className="run-debug-settings__detail" data-selectable>{detail}</p>
    </details>
  );
}

function DiagnosticStatus({ status, checked }: { status: Status; checked?: boolean }) {
  const message = checked && status === "ready" ? "runDebugPassed" : statusLabels[status];
  return (
    <span className="run-debug-settings__badge" data-status={status} role={checked ? "status" : undefined}>
      <Icon name={statusIcons[status]} size={12} />{t(message)}
    </span>
  );
}

export default function RunDebugSection() {
  const toolchainHeading = useId();
  const healthHeading = useId();
  const pending = useRef<symbol | undefined>(undefined);
  const [state, setState] = useState<CheckState>({});
  const desktop = isTauri();
  const { report, checking, progress, failed } = state;
  const testing = checking === "test";

  const refresh = useCallback(async (runSelfTests: boolean) => {
    if (!desktop || pending.current) return;
    const request = Symbol();
    pending.current = request;
    setState(({ report }) => ({ report, checking: runSelfTests ? "test" : "detect" }));
    try {
      const report = await checkRunDebugEnvironment(runSelfTests, runSelfTests ? (progress) => {
        if (pending.current !== request) return;
        setState((previous) => ({ ...previous, progress: { ...previous.progress, [progress.id]: progress } }));
      } : undefined);
      if (pending.current === request) setState({ report });
    } catch {
      if (pending.current === request) setState(({ report }) => ({ report, failed: true }));
    } finally {
      if (pending.current === request) pending.current = undefined;
    }
  }, [desktop]);

  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => { if (mounted) void refresh(false); });
    return () => {
      mounted = false;
      pending.current = undefined;
    };
  }, [refresh]);

  const unavailable = !desktop || checking !== undefined;
  const notice = !desktop ? t("runDebugDesktop") : failed ? t("runDebugLoadFailed")
    : checking === "detect" ? t("runDebugDetecting") : "";

  return (
    <div className="run-debug-settings">
      <section aria-labelledby={toolchainHeading}>
        <header className="run-debug-settings__header">
          <h2 id={toolchainHeading}>{t("runDebugToolchain")}</h2>
          <div className="run-debug-settings__actions">
            <button type="button" aria-disabled={unavailable || undefined} onClick={() => void refresh(false)}>
              {t("runDebugRefresh")}
            </button>
            <button type="button" className="run-debug-settings__primary" aria-disabled={unavailable || undefined}
              aria-busy={testing || undefined}
              onClick={() => void refresh(true)}>
              {testing ? t("runDebugTesting") : t("runDebugSelfTest")}
            </button>
          </div>
        </header>
        <p role={failed ? "alert" : "status"} className="run-debug-settings__notice" data-error={failed || undefined}>{notice}</p>
        <ul className="run-debug-settings__rows" aria-busy={!!checking || undefined}>
          {toolIds.map((id) => {
            const tool = report?.tools.find((tool) => tool.id === id);
            return (
              <li key={id} className="run-debug-settings__row">
                <div className="run-debug-settings__row-heading">
                  <h3>{t(toolLabels[id])}</h3>
                  <DiagnosticStatus status={tool?.status ?? "unchecked"} />
                </div>
                {tool?.version && <p className="run-debug-settings__version" data-selectable>{tool.version}</p>}
                {tool?.path && <code className="run-debug-settings__path" data-selectable>{tool.path}</code>}
                <DiagnosticDetail detail={tool?.detail} />
              </li>
            );
          })}
        </ul>
        {report?.tools.some((tool) => tool.status === "missing") && (
          <p className="run-debug-settings__hint">{t("runDebugMissingToolHint")}</p>
        )}
      </section>
      <section aria-labelledby={healthHeading}>
        <h2 id={healthHeading}>{t("runDebugHealth")}</h2>
        <ul className="run-debug-settings__rows" aria-busy={checking === "detect" || undefined}>
          {checkIds.map((id) => {
            const check = testing ? progress?.[id] : report?.checks.find((check) => check.id === id);
            const timeout = check?.phase && t(debugTimeoutMessages[check.phase]);
            return (
              <li key={id} className="run-debug-settings__row">
                <div className="run-debug-settings__row-heading">
                  <h3>{t(checkLabels[id])}</h3>
                  <DiagnosticStatus status={check?.status ?? "unchecked"} checked />
                </div>
                {timeout && <p className="run-debug-settings__detail">{timeout}</p>}
                <DiagnosticDetail detail={check?.detail === timeout ? undefined : check?.detail} />
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
