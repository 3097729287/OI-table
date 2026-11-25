import { invoke } from "@tauri-apps/api/core";
import type { CodeLanguage } from "../../shared/ui/codeLanguages";

export type RunStatus = "success" | "compile_error" | "runtime_error" | "compile_timeout" | "runtime_timeout" | "output_limit";

export interface RunResult {
  status: RunStatus;
  stdout: string;
  stderr: string;
  durationMs: number;
  exitCode: number | null;
}

export type LocalRun =
  | { state: "running"; language: CodeLanguage }
  | { state: "complete"; language: CodeLanguage; result: RunResult }
  | { state: "failed"; language: CodeLanguage; error: string };

export async function runEditorCode(language: CodeLanguage, source: string, input: string): Promise<LocalRun> {
  try {
    const result = await invoke<RunResult>("run_editor_code", { language, source, input });
    return { state: "complete", language, result };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code : "run_failed";
    return { state: "failed", language, error: code };
  }
}
