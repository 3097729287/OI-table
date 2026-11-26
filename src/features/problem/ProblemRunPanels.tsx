import { useMessages } from "../../i18n";
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
} as const satisfies Record<RunStatus, keyof ReturnType<typeof useMessages>>;

const errorMessages: Record<string, keyof ReturnType<typeof useMessages>> = {
  tool_unavailable: "problemRunToolUnavailable",
  run_busy: "problemRunBusy",
  source_too_large: "problemEditorSourceTooLarge",
  input_too_large: "problemRunInputTooLarge",
};

export type ProblemRunResult = LocalRun
  | { state: "loading-draft" | "running" | "empty-draft" | "failed-draft" }
  | { state: "debug"; stdout: string; stderr: string };

export function ProblemRunResults({ run }: { run?: ProblemRunResult }) {
  const messages = useMessages();
  const output = run?.state === "complete" ? run.result : run?.state === "debug" ? run : undefined;
  const sample = run?.state === "complete" ? run.sample : undefined;
  return (
    <ScrollArea className="problem-run__results" orientation="vertical">
      <div className="problem-run__results-body">
        {!run && <StatusMessage state="empty">{messages.problemRunEmpty}</StatusMessage>}
        {run?.state === "running" && <StatusMessage state="loading">{messages.problemRunRunning}</StatusMessage>}
        {run?.state === "loading-draft" && <StatusMessage state="loading">{messages.problemDraftLoading}</StatusMessage>}
        {run?.state === "empty-draft" && <StatusMessage state="empty">{messages.problemSampleWriteCode}</StatusMessage>}
        {run?.state === "failed-draft" && <StatusMessage state="error">{messages.problemDraftLoadFailed}</StatusMessage>}
        {run?.state === "failed" && (
          <StatusMessage state="error">{messages[errorMessages[run.error] ?? "problemRunFailed"]}</StatusMessage>
        )}
        {run?.state === "complete" && (
          <div className="problem-run__summary" role="status">
            {sample ? (
              <strong data-status={sample.matches ? "success" : "sample-mismatch"}>
                {sample.matches ? messages.problemSampleMatched : messages.problemSampleMismatch}
              </strong>
            ) : <strong data-status={run.result.status}>{messages[resultMessages[run.result.status]]}</strong>}
            <span>{run.language === "cpp" ? "C++" : "Python"}</span>
            {run.result.exitCode !== null && (
              <span>{messages.problemRunExitCode.replace("{code}", String(run.result.exitCode))}</span>
            )}
            <span>{messages.problemRunDuration.replace("{duration}", String(run.result.durationMs))}</span>
          </div>
        )}
        {output && (
          <>
            {(sample || output.stdout) && <RunStream title={messages.problemRunStdout} text={output.stdout} />}
            {sample && <RunStream title={messages.problemSampleExpected} text={sample.expected} />}
            {output.stderr && <RunStream title={messages.problemRunStderr} text={output.stderr} />}
            {!sample && !output.stdout && !output.stderr && (
              <p className="problem-run__empty-output">{messages.problemRunEmptyOutput}</p>
            )}
          </>
        )}
      </div>
    </ScrollArea>
  );
}

function RunStream({ title, text }: { title: string; text: string }) {
  const messages = useMessages();
  return (
    <section className="problem-run__stream">
      <h2>{title}</h2>
      <ScrollArea orientation="horizontal" focusScrollbar>
        <pre data-selectable>{text || messages.problemSampleEmptyOutput}</pre>
      </ScrollArea>
    </section>
  );
}
