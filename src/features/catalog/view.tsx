import type { WorkspaceViewOptions } from "../../workspace/views";

export { ProblemListView as default } from "./ProblemListView";

export const workspaceView = {
  id: "catalog",
  title: "allProblems",
  icon: "problems",
  section: "catalog",
  sidebarTitle: "allProblems",
  sidebarGroups: [{ id: "problems", title: "catalog" }],
  order: 10,
} satisfies WorkspaceViewOptions;
