import { t } from "../../i18n";
import { StatusMessage } from "../../shared/StatusMessage";
import type { WorkspaceViewOptions } from "../../workspace/views";

export const workspaceView = {
  id: "problem-lists",
  title: "problemLists",
  icon: "problemLists",
} satisfies WorkspaceViewOptions;

export default function ProblemListsView() {
  return (
    <section className="workspace workbench-page">
      <h1>{t("problemLists")}</h1>
      <StatusMessage state="empty">{t("emptyWorkspace")}</StatusMessage>
    </section>
  );
}
