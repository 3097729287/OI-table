import { t, type MessageKey } from "../../i18n";
import { StatusMessage } from "../../shared/StatusMessage";
import { ScrollArea } from "../../shared/ui/ScrollArea";
import type { LocalRun, RunStatus } from "./localRun";
import "./problem-run.css";

const resultMessages = {
  success: "problemRunSuccess",
  compile_error: "problemRunCompileError",
  runtime_error: "problemRunRuntimeError",
  compile_timeout: "problemRunCompileTimeout",
  runtime_timeout: "problemRunRuntimeTimeout",
  output_limit: "problemRunOutputLimit",
} as const satisfies Record<RunStatus, MessageKey>;

const errorMessages: Record<string, MessageKey> = {
  tool_unavailable: "problemRunToolUnavailable",
  run_busy: "problemRunBusy",
  source_too_large: "problemEditorSourceTooLarge",
  input_too_large: "problemRunInputTooLarge",
};

export type ProblemRunResult = LocalRun
  | { state: "loading-draft" | "running" | "empty-draft" | "failed-draft" }
  | { state: "debug"; stdout: string; stderr: string };

export function ProblemRunResults({ run }: { run?: ProblemRunResult }) {
  const output = run?.state === "complete" ? run.result : run?.state === "debug" ? run : undefined;
  const sample = run?.state === "complete" ? run.sample : undefined;
  return (
    <ScrollArea className="problem-run__results" orientation="vertical">
      <div className="problem-run__results-body">
        {!run && <StatusMessage state="empty">{t("problemRunEmpty")}</StatusMessage>}
        {run?.state === "running" && <StatusMessage state="loading">{t("problemRunRunning")}</StatusMessage>}
        {run?.state === "loading-draft" && <StatusMessage state="loading">{t("problemDraftLoading")}</StatusMessage>}
        {run?.state === "empty-draft" && <StatusMessage state="empty">{t("problemSampleWriteCode")}</StatusMessage>}
        {run?.state === "failed-draft" && <StatusMessage state="error">{t("problemDraftLoadFailed")}</StatusMessage>}
        {run?.state === "failed" && (
          <StatusMessage state="error">{t(errorMessages[run.error] ?? "problemRunFailed")}</StatusMessage>
        )}
        {run?.state === "complete" && (
          <div className="problem-run__summary" role="status">
            {sample ? (
              <strong data-status={sample.matches ? "success" : "sample-mismatch"}>
                {sample.matches ? t("problemSampleMatched") : t("problemSampleMismatch")}
              </strong>
            ) : <strong data-status={run.result.status}>{t(resultMessages[run.result.status])}</strong>}
            <span>{run.language === "cpp" ? "C++" : "Python"}</span>
            {run.result.exitCode !== null && (
              <span>{t("problemRunExitCode", { code: run.result.exitCode })}</span>
            )}
            <span>{t("problemRunDuration", { duration: run.result.durationMs })}</span>
          </div>
        )}
        {output && (
          <>
            {(sample || output.stdout) && <RunStream title={t("problemRunStdout")} text={output.stdout} />}
            {sample && <RunStream title={t("problemSampleExpected")} text={sample.expected} />}
            {output.stderr && <RunStream title={t("problemRunStderr")} text={output.stderr} />}
            {!sample && !output.stdout && !output.stderr && (
              <p className="problem-run__empty-output">{t("problemRunEmptyOutput")}</p>
            )}
          </>
        )}
      </div>
    </ScrollArea>
  );
}

function RunStream({ title, text }: { title: string; text: string }) {
  return (
    <section className="problem-run__stream">
      <h2>{title}</h2>
      <ScrollArea orientation="horizontal" focusScrollbar>
        <pre data-selectable>{text || t("problemSampleEmptyOutput")}</pre>
      </ScrollArea>
    </section>
  );
}
