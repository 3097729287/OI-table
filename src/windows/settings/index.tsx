import { useState } from "react";
import { themes, updateSettings, useSettings, type AppSettings, type Theme } from "../../shared/settings";
import { messages } from "../../i18n";
import { StatusMessage } from "../../shared/StatusMessage";
import type { WindowOptions } from "../../windowing/routes";
import "./settings.css";

export const windowOptions = {
  title: messages.settings,
} satisfies WindowOptions;

const themeLabels = {
  system: messages.themeSystem,
  light: messages.themeLight,
  dark: messages.themeDark,
} satisfies Record<Theme, string>;

export default function SettingsWindow() {
  const { settings, loadFailed } = useSettings();
  const [saveFailed, setSaveFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [logSizeDraft, setLogSizeDraft] = useState<string>();
  const logSize = logSizeDraft ?? String(settings?.logMaxSizeMib ?? "");
  const nextLogSize = Number(logSize);
  const canSaveLogSize = Number.isInteger(nextLogSize) &&
    nextLogSize >= 1 && nextLogSize <= 100 && nextLogSize !== settings?.logMaxSizeMib;

  async function saveChanges(changes: Partial<AppSettings>) {
    setSaving(true);
    setSaveFailed(false);
    try {
      await updateSettings(changes);
      return true;
    } catch {
      setSaveFailed(true);
      return false;
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="workspace">
      <h1>{messages.settings}</h1>
      {settings && (
        <>
          <label className="settings-row">
            {messages.appearance}
            <select value={settings.theme} disabled={saving} onChange={(event) => {
              void saveChanges({ theme: event.currentTarget.value as Theme });
            }}>
              {themes.map((option) => <option key={option} value={option}>{themeLabels[option]}</option>)}
            </select>
          </label>
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
        </>
      )}
      {!settings && !loadFailed && <StatusMessage state="loading">{messages.settingsLoading}</StatusMessage>}
      {loadFailed && <StatusMessage state="error">{messages.settingsLoadFailed}</StatusMessage>}
      {saveFailed && <StatusMessage state="error">{messages.settingsSaveFailed}</StatusMessage>}
    </main>
  );
}
