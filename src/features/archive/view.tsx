import { useMessages } from "../../i18n";
import { StatusMessage } from "../../shared/StatusMessage";
import type { WorkspaceViewOptions, WorkspaceViewProps } from "../../workspace/views";

export const workspaceView = {
  id: "archive",
  title: "archive",
  icon: "archive",
  section: "archive",
  sidebarTitle: "allArchives",
  variants: [
    { params: { filter: "contests" }, title: "contestArchives" },
    { params: { filter: "personal" }, title: "personalArchives" },
  ],
  order: 30,
} satisfies WorkspaceViewOptions;

export default function ArchiveView({ title }: WorkspaceViewProps) {
  const messages = useMessages();
  return (
    <section className="workspace workbench-page">
      <h1>{title}</h1>
      <StatusMessage state="empty">{messages.emptyWorkspace}</StatusMessage>
    </section>
  );
}
