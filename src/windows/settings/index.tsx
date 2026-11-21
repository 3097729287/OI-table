import { useState } from "react";
import { themes, updateSettings, useSettings, type Theme } from "../../shared/settings";
import { messages } from "../../i18n";
import { StatusMessage } from "../../shared/StatusMessage";
import type { WindowOptions } from "../../windowing/routes";
import "./settings.css";

export const windowOptions = {
  title: messages.settings,
  showInToolbar: true,
} satisfies WindowOptions;

const themeLabels = {
  system: messages.themeSystem,
  light: messages.themeLight,
  dark: messages.themeDark,
} satisfies Record<Theme, string>;

export default function Settings() {
  const { settings, loadFailed } = useSettings();
  const [saveFailed, setSaveFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  async function selectTheme(next: Theme) {
    setSaving(true);
    setSaveFailed(false);
    try {
      await updateSettings({ theme: next });
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="workspace">
      <h1>{messages.settings}</h1>
      {settings && (
        <label className="appearance-setting">
          {messages.appearance}
          <select value={settings.theme} disabled={saving} onChange={(event) => {
            void selectTheme(event.currentTarget.value as Theme);
          }}>
            {themes.map((option) => <option key={option} value={option}>{themeLabels[option]}</option>)}
          </select>
        </label>
      )}
      {!settings && !loadFailed && <StatusMessage state="loading">{messages.settingsLoading}</StatusMessage>}
      {loadFailed && <StatusMessage state="error">{messages.settingsLoadFailed}</StatusMessage>}
      {saveFailed && <StatusMessage state="error">{messages.settingsSaveFailed}</StatusMessage>}
    </main>
  );
}
