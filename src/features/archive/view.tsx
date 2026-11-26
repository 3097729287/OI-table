import { useMessages } from "../../i18n";
import { ProblemListPage, type ProblemListFilters } from "../../shared/ProblemListPage";
import { StatusMessage } from "../../shared/StatusMessage";
import type { WorkspaceViewOptions, WorkspaceViewProps } from "../../workspace/views";

export const workspaceView = {
  id: "archive",
  title: "archive",
  icon: "archive",
  variants: {
    contests: { params: { filter: "contests" }, title: "contestArchives" },
    libraries: { params: { filter: "libraries" }, title: "libraryArchives" },
  },
} satisfies WorkspaceViewOptions;

const libraryArchiveFilters: ProblemListFilters = {};

export default function ArchiveView({ params, title, open }: WorkspaceViewProps) {
  const messages = useMessages();
  if (params.filter === "libraries") return <ProblemListPage title={title} open={open} filters={libraryArchiveFilters} />;

  return (
    <section className="workspace workbench-page">
      <h1>{title}</h1>
      <StatusMessage state="empty">{messages.emptyWorkspace}</StatusMessage>
    </section>
  );
}
