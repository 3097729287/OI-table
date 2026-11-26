import { useMessages } from "../../i18n";
import { StatusMessage } from "../../shared/StatusMessage";
import type { WorkspaceViewOptions, WorkspaceViewProps } from "../../workspace/views";
import { ProblemListView } from "../catalog/ProblemListView";

export const workspaceView = {
  id: "archive",
  title: "archive",
  icon: "archive",
  section: "archive",
  sidebarTitle: false,
  sidebarGroups: [{ id: "all-archives", title: "allArchives" }],
  variants: [
    { params: { filter: "contests" }, title: "contestArchives" },
    { params: { filter: "libraries" }, title: "libraryArchives" },
  ],
  order: 30,
} satisfies WorkspaceViewOptions;

export default function ArchiveView(props: WorkspaceViewProps) {
  const messages = useMessages();
  if (props.params.filter === "libraries") return <ProblemListView {...props} />;

  return (
    <section className="workspace workbench-page">
      <h1>{props.title}</h1>
      <StatusMessage state="empty">{messages.emptyWorkspace}</StatusMessage>
    </section>
  );
}
