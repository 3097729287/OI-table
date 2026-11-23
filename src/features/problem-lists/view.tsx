import { messages } from "../../i18n";
import { StatusMessage } from "../../shared/StatusMessage";
import type { WorkspaceViewOptions } from "../../workspace/views";

export const workspaceView = {
  title: messages.problemLists,
  icon: "problemLists",
  section: "catalog",
  sidebarTitle: messages.allProblemLists,
  sidebarGroups: [{ id: "problem-lists", title: messages.problemLists }],
  order: 15,
} satisfies WorkspaceViewOptions;

export default function ProblemListsView() {
  return (
    <section className="workspace workbench-page">
      <h1>{messages.problemLists}</h1>
      <StatusMessage state="empty">{messages.emptyWorkspace}</StatusMessage>
    </section>
  );
}
