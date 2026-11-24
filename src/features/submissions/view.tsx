import { useMessages } from "../../i18n";
import { StatusMessage } from "../../shared/StatusMessage";
import type { WorkspaceViewOptions, WorkspaceViewProps } from "../../workspace/views";

export const workspaceView = {
  id: "submissions",
  title: "submissionHistory",
  icon: "submissions",
  section: "submissions",
  sidebarTitle: "allSubmissions",
  variants: [
    { params: { filter: "local" }, title: "localTestHistory" },
    { params: { filter: "online" }, title: "onlineSubmissionHistory" },
  ],
  order: 50,
} satisfies WorkspaceViewOptions;

export default function SubmissionsView({ title }: WorkspaceViewProps) {
  const messages = useMessages();
  return (
    <section className="workspace workbench-page">
      <h1>{title}</h1>
      <StatusMessage state="empty">{messages.emptyWorkspace}</StatusMessage>
    </section>
  );
}
