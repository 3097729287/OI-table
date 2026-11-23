import { messages } from "../../i18n";
import { StatusMessage } from "../../shared/StatusMessage";
import type { WorkspaceViewOptions, WorkspaceViewProps } from "../../workspace/views";

export const workspaceView = {
  title: messages.archive,
  icon: "archive",
  section: "archive",
  sidebarTitle: messages.allArchives,
  variants: [
    { id: "contests", title: messages.contestArchives },
    { id: "personal", title: messages.personalArchives },
  ],
  order: 30,
} satisfies WorkspaceViewOptions;

export default function ArchiveView({ title }: WorkspaceViewProps) {
  return (
    <section className="workspace workbench-page">
      <h1>{title}</h1>
      <StatusMessage state="empty">{messages.emptyWorkspace}</StatusMessage>
    </section>
  );
}
