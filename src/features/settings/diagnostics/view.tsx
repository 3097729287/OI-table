import { useState } from "react";
import { messages } from "../../../i18n";
import type { WorkspaceViewOptions, WorkspaceViewProps } from "../../../workspace/views";
import { SettingsPage } from "../SettingsPage";
import { useSettingsForm } from "../useSettingsForm";

export const workspaceView = {
  title: messages.dataAndDiagnostics,
  icon: "submissions",
  section: "settings",
  order: 90,
} satisfies WorkspaceViewOptions;

export default function DiagnosticsView({ title }: WorkspaceViewProps) {
  const form = useSettingsForm();
  const { settings, saving, saveChanges } = form;
  const [logSizeDraft, setLogSizeDraft] = useState<string>();
  const logSize = logSizeDraft ?? String(settings?.logMaxSizeMib ?? "");
  const nextLogSize = Number(logSize);
  const canSaveLogSize = Number.isInteger(nextLogSize) &&
    nextLogSize >= 1 && nextLogSize <= 100 && nextLogSize !== settings?.logMaxSizeMib;

  return (
    <SettingsPage title={title} form={form}>
      {settings && (
        <section className="log-settings" aria-labelledby="log-settings-heading">
          <h2 id="log-settings-heading">{messages.localLogs}</h2>
          <form className="settings-row" onSubmit={(event) => {
            event.preventDefault();
            if (saving || !canSaveLogSize) return;
            void saveChanges({ logMaxSizeMib: nextLogSize }).then((saved) => {
              if (saved) setLogSizeDraft(undefined);
            });
          }}>
            <label htmlFor="log-max-size">{messages.logMaxSizeMib}</label>
            <div className="settings-actions">
              <input
                id="log-max-size"
                type="number"
                min={1}
                max={100}
                step={1}
                required
                data-selectable
                value={logSize}
                disabled={saving}
                aria-describedby="log-retention"
                onChange={(event) => setLogSizeDraft(event.currentTarget.value)}
              />
              <button type="submit" disabled={saving || !canSaveLogSize}>{messages.save}</button>
            </div>
          </form>
          <p id="log-retention">{messages.logRetention}</p>
        </section>
      )}
    </SettingsPage>
  );
}
