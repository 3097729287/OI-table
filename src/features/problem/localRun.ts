import { invoke } from "@tauri-apps/api/core";
import type { CodeLanguage } from "../../shared/codeLanguages";

export type RunStatus = "success" | "compile_error" | "runtime_error" | "compile_timeout" | "runtime_timeout" | "output_limit";

export interface RunResult {
  status: RunStatus;
  stdout: string;
  stderr: string;
  durationMs: number;
  exitCode: number | null;
}

export type LocalRun =
  | { state: "complete"; language: CodeLanguage; result: RunResult; sample?: { expected: string; matches: boolean } }
  | { state: "failed"; error: string };

function normalizeSampleOutput(output: string) {
  return output.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n+$/, "");
}

export async function runEditorCode(language: CodeLanguage, source: string, input: string, expected?: string): Promise<LocalRun> {
  try {
    const result = await invoke<RunResult>("run_editor_code", { language, source, input });
    const sample = expected !== undefined && result.status === "success"
      ? { expected, matches: normalizeSampleOutput(result.stdout) === normalizeSampleOutput(expected) }
      : undefined;
    return { state: "complete", language, result, sample };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code : "run_failed";
    return { state: "failed", error: code };
  }
}
