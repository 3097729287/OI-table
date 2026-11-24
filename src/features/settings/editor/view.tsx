import type { WorkspaceViewOptions } from "../../../workspace/views";

export const workspaceView = {
  title: "editor",
  icon: "editor",
  section: "settings",
  order: 70,
} satisfies WorkspaceViewOptions;

export { EmptySettingsPage as default } from "../SettingsPage";
