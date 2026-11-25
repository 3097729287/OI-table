import type { MessageKey } from "../i18n";

export const debugTimeoutMessages = {
  compile: "problemDebugCompileTimeout",
  programStart: "problemDebugProgramStartTimeout",
  debuggerReply: "problemDebugReplyTimeout",
  programStop: "problemDebugProgramTimeout",
  inspection: "problemDebugInspectionTimeout",
} as const satisfies Record<string, MessageKey>;

export type DebugTimeoutPhase = keyof typeof debugTimeoutMessages;
