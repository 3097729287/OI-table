import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";
import { useMessages } from "../../i18n";
import type { WorkspaceProviderProps } from "../../workspace/sidebarMenu";
import { ProblemDebugContext, useLocalDebug, type ProblemDebugLaunch } from "./localDebug";

export const problemDebugSidebarId = "debug";

export function ProblemDebugProvider({ activeTarget, openSidebar, revealTarget, children }: WorkspaceProviderProps) {
  const messages = useMessages();
  const activeProblemId = activeTarget?.id === "problem" ? activeTarget.params.problemId : undefined;
  const [registeredLaunch, setRegisteredLaunch] = useState<{ problemId: string; launch: ProblemDebugLaunch }>();

  const registerLaunch = useCallback((problemId: string, launch: ProblemDebugLaunch) => {
    const entry = { problemId, launch };
    setRegisteredLaunch(entry);
    return () => setRegisteredLaunch((current) => current === entry ? undefined : current);
  }, []);
  const launch = !isTauri() ? { message: messages.problemDebugDesktop }
    : registeredLaunch?.problemId === activeProblemId ? registeredLaunch?.launch : undefined;
  const debug = useLocalDebug(
    () => openSidebar(problemDebugSidebarId),
    (problemId) => revealTarget({ id: "problem", params: { problemId } }),
  );

  return <ProblemDebugContext value={{ ...debug, activeProblemId, registerLaunch, launch }}>{children}</ProblemDebugContext>;
}
