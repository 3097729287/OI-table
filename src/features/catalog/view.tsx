import { useMessages } from "../../i18n";
import { StatusMessage } from "../../shared/StatusMessage";
import type { WorkspaceViewOptions } from "../../workspace/views";

export const workspaceView = {
  title: "catalog",
  icon: "problems",
  section: "catalog",
  sidebarTitle: "allProblems",
  sidebarGroups: [{ id: "problems", title: "catalog" }],
  order: 10,
} satisfies WorkspaceViewOptions;

export default function CatalogView() {
  const messages = useMessages();
  return (
    <section className="workspace workbench-page">
      <h1>{messages.catalog}</h1>
      <StatusMessage state="empty">{messages.catalogNotConnected}</StatusMessage>
    </section>
  );
}
