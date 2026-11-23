import { messages } from "../../i18n";
import { StatusMessage } from "../../shared/StatusMessage";
import type { WorkspaceViewOptions, WorkspaceViewProps } from "../../workspace/views";

export const workspaceView = {
  title: messages.submissionHistory,
  icon: "submissions",
  section: "submissions",
  sidebarTitle: messages.allSubmissions,
  variants: [
    { id: "local", title: messages.localTestHistory },
    { id: "online", title: messages.onlineSubmissionHistory },
  ],
  order: 50,
} satisfies WorkspaceViewOptions;

export default function SubmissionsView({ title }: WorkspaceViewProps) {
  return (
    <section className="workspace workbench-page">
      <h1>{title}</h1>
      <StatusMessage state="empty">{messages.emptyWorkspace}</StatusMessage>
    </section>
  );
}
