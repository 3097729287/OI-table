import { useMessages } from "../../../i18n";
import { NumberSetting } from "../NumberSetting";
import type { SettingsSectionProps } from "../view";

export default function DiagnosticsSection({ settings, saveChanges }: SettingsSectionProps) {
  const messages = useMessages();

  return (
    <section className="log-settings" aria-labelledby="log-settings-heading">
      <h2 id="log-settings-heading">{messages.localLogs}</h2>
      <NumberSetting id="log-max-size" setting="logMaxSizeMib" label={messages.logMaxSizeMib}
        description={messages.logRetention} invalidMessage={messages.logSizeInvalid}
        min={1} max={100} value={settings.logMaxSizeMib} saveChanges={saveChanges} />
    </section>
  );
}
