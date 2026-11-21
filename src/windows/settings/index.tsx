import { useState } from "react";
import { changeTheme, themes, useTheme, type Theme } from "../../shared/appearance";
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
  const theme = useTheme();
  const [error, setError] = useState<Awaited<ReturnType<typeof changeTheme>>>();
  const [saving, setSaving] = useState(false);

  async function selectTheme(next: Theme) {
    setSaving(true);
    setError(await changeTheme(next));
    setSaving(false);
  }

  return (
    <main className="workspace">
      <h1>{messages.settings}</h1>
      <label className="appearance-setting">
        {messages.appearance}
        <select value={theme} disabled={saving} onChange={(event) => {
          void selectTheme(event.currentTarget.value as Theme);
        }}>
          {themes.map((option) => <option key={option} value={option}>{themeLabels[option]}</option>)}
        </select>
      </label>
      {error && <StatusMessage state="error">{messages[error]}</StatusMessage>}
    </main>
  );
}
