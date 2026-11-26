import { Channel, invoke } from "@tauri-apps/api/core";
import type { DebugTimeoutPhase } from "../../../shared/debugDiagnostics";

export interface RunDebugTool {
  id: "cpp" | "python" | "gdb";
  status: "ready" | "missing" | "failed";
  path?: string;
  version?: string;
  detail?: string;
}

export interface RunDebugCheck {
  id: "cppRun" | "pythonRun" | "cppDebug" | "pythonDebug";
  status: "checking" | "ready" | "missing" | "failed" | "unchecked" | "busy";
  detail?: string;
  phase?: DebugTimeoutPhase;
}

export interface RunDebugReport {
  tools: readonly RunDebugTool[];
  checks: readonly RunDebugCheck[];
}

export type RunDebugProgress = RunDebugCheck;

export function checkRunDebugEnvironment(runSelfTests: boolean, onProgress?: (progress: RunDebugProgress) => void) {
  return invoke<RunDebugReport>("check_run_debug_environment", {
    runSelfTests,
    onProgress: new Channel<RunDebugProgress>(onProgress),
  });
}
