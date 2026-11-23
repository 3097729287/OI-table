import { messages } from "../../i18n";
import { StatusMessage } from "../../shared/StatusMessage";
import type { WorkspaceViewOptions } from "../../workspace/views";

export const workspaceView = {
  title: messages.catalog,
  icon: "problems",
  section: "catalog",
  sidebarTitle: messages.allProblems,
  sidebarGroups: [{ id: "problems", title: messages.catalog }],
  order: 10,
} satisfies WorkspaceViewOptions;

export default function CatalogView() {
  return (
    <section className="workspace workbench-page">
      <h1>{messages.catalog}</h1>
      <StatusMessage state="empty">{messages.catalogNotConnected}</StatusMessage>
    </section>
  );
}
