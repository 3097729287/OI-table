import { messages } from "../../i18n";
import { StatusMessage } from "../../shared/StatusMessage";
import type { WorkspaceViewOptions } from "../../workspace/views";

export const workspaceView = {
  title: messages.archive,
  icon: "archive",
  section: "archive",
  sidebarTitle: messages.allArchives,
  order: 30,
} satisfies WorkspaceViewOptions;

export default function ArchiveView() {
  return (
    <section className="workspace workbench-page">
      <h1>{messages.archive}</h1>
      <StatusMessage state="empty">{messages.emptyWorkspace}</StatusMessage>
    </section>
  );
}
