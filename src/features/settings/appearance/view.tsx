import { messages } from "../../../i18n";
import { themes, type Theme } from "../../../shared/settings";
import type { WorkspaceViewOptions, WorkspaceViewProps } from "../../../workspace/views";
import { SettingsPage } from "../SettingsPage";
import { useSettingsForm } from "../useSettingsForm";

export const workspaceView = {
  title: messages.appearance,
  icon: "settings",
  section: "settings",
  order: 60,
} satisfies WorkspaceViewOptions;

const themeLabels = {
  system: messages.themeSystem,
  light: messages.themeLight,
  dark: messages.themeDark,
} satisfies Record<Theme, string>;

export default function AppearanceView({ title }: WorkspaceViewProps) {
  const form = useSettingsForm();
  const { settings, saving, saveChanges } = form;

  return (
    <SettingsPage title={title} form={form}>
      {settings && (
        <label className="settings-row">
          {messages.theme}
          <select value={settings.theme} disabled={saving} onChange={(event) => {
            void saveChanges({ theme: event.currentTarget.value as Theme });
          }}>
            {themes.map((option) => <option key={option} value={option}>{themeLabels[option]}</option>)}
          </select>
        </label>
      )}
    </SettingsPage>
  );
}
