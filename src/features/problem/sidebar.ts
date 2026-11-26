import type { SidebarSection } from "../../workspace/sidebarMenu";
import { ProblemDebugPanel } from "./ProblemDebugPanel";
import { ProblemDebugProvider, problemDebugSidebarId } from "./ProblemDebugProvider";

export default {
  id: problemDebugSidebarId,
  title: "problemDebugSidebar",
  icon: "debug",
  order: 50,
  Panel: ProblemDebugPanel,
  Provider: ProblemDebugProvider,
} satisfies SidebarSection;
