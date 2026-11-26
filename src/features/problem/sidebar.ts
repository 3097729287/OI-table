import type { SidebarSection } from "../../workspace/sidebarMenu";
import { ProblemDebugPanel } from "./ProblemDebugPanel";

export default {
  id: "debug",
  title: "problemDebugSidebar",
  icon: "debug",
  order: 50,
  Panel: ProblemDebugPanel,
} satisfies SidebarSection;
