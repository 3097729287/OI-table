import { useMessages } from "../../i18n";
import { StatusMessage } from "../../shared/StatusMessage";
import type { WorkspaceViewOptions } from "../../workspace/views";

export const workspaceView = {
  title: "problemLists",
  icon: "problemLists",
  section: "catalog",
  sidebarTitle: "allProblemLists",
  sidebarGroups: [{ id: "problem-lists", title: "problemLists" }],
  order: 15,
} satisfies WorkspaceViewOptions;

export default function ProblemListsView() {
  const messages = useMessages();
  return (
    <section className="workspace workbench-page">
      <h1>{messages.problemLists}</h1>
      <StatusMessage state="empty">{messages.emptyWorkspace}</StatusMessage>
    </section>
  );
}
