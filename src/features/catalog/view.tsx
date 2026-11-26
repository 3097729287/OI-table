import type { WorkspaceViewOptions } from "../../workspace/views";

export { ProblemListView as default } from "./ProblemListView";

export const workspaceView = {
  id: "catalog",
  title: "allProblems",
  icon: "problems",
} satisfies WorkspaceViewOptions;
