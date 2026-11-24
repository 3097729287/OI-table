import type { WorkspaceViewOptions } from "../../../workspace/views";

export const workspaceView = {
  title: "runAndDebug",
  icon: "run",
  section: "settings",
  order: 80,
} satisfies WorkspaceViewOptions;

export { EmptySettingsPage as default } from "../SettingsPage";
