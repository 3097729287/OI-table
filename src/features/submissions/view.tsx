import { t } from "../../i18n";
import { StatusMessage } from "../../shared/StatusMessage";
import type { WorkspaceViewOptions, WorkspaceViewProps } from "../../workspace/views";

export const workspaceView = {
  id: "submissions",
  title: "submissionHistory",
  icon: "submissions",
  variants: {
    local: { params: { filter: "local" }, title: "localSubmissionHistory" },
    online: { params: { filter: "online" }, title: "onlineSubmissionHistory" },
  },
} satisfies WorkspaceViewOptions;

export default function SubmissionsView({ title }: WorkspaceViewProps) {
  return (
    <section className="workspace workbench-page">
      <h1>{title}</h1>
      <StatusMessage state="empty">{t("emptyWorkspace")}</StatusMessage>
    </section>
  );
}
