import { messages } from "../../i18n";
import { StatusMessage } from "../../shared/StatusMessage";
import type { WorkspaceViewOptions } from "../../workspace/views";

export const workspaceView = {
  title: messages.submissionHistory,
  icon: "submissions",
  section: "submissions",
  sidebarTitle: messages.allSubmissions,
  order: 50,
} satisfies WorkspaceViewOptions;

export default function SubmissionsView() {
  return (
    <section className="workspace workbench-page">
      <h1>{messages.submissionHistory}</h1>
      <StatusMessage state="empty">{messages.emptyWorkspace}</StatusMessage>
    </section>
  );
}
