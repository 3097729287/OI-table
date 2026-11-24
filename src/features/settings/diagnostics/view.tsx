import { useMessages } from "../../../i18n";
import type { WorkspaceViewOptions, WorkspaceViewProps } from "../../../workspace/views";
import { NumberSetting } from "../NumberSetting";
import { SettingsPage } from "../SettingsPage";
import { useSettingsForm } from "../useSettingsForm";

export const workspaceView = {
  title: "dataAndDiagnostics",
  icon: "submissions",
  section: "settings",
  order: 90,
} satisfies WorkspaceViewOptions;

export default function DiagnosticsView({ title }: WorkspaceViewProps) {
  const messages = useMessages();
  const form = useSettingsForm();
  const { settings, saveChanges } = form;

  return (
    <SettingsPage title={title} form={form}>
      {settings && (
        <section className="log-settings" aria-labelledby="log-settings-heading">
          <h2 id="log-settings-heading">{messages.localLogs}</h2>
          <NumberSetting id="log-max-size" setting="logMaxSizeMib" label={messages.logMaxSizeMib}
            description={messages.logRetention} invalidMessage={messages.logSizeInvalid}
            min={1} max={100} value={settings.logMaxSizeMib} saveChanges={saveChanges} />
        </section>
      )}
    </SettingsPage>
  );
}
