import { messages } from "../../../i18n";
import { themes, type Theme } from "../../../shared/settings";
import { Select } from "../../../shared/ui/Fields";
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

const themeOptions = themes.map((value) => ({ value, label: themeLabels[value] }));

export default function AppearanceView({ title }: WorkspaceViewProps) {
  const form = useSettingsForm();
  const { settings, saving, saveChanges } = form;

  return (
    <SettingsPage title={title} form={form}>
      {settings && (
        <div className="settings-row">
          <label id="settings-theme-label" htmlFor="settings-theme">{messages.theme}</label>
          <Select id="settings-theme" aria-labelledby="settings-theme-label"
            value={settings.theme} options={themeOptions} disabled={saving}
            onValueChange={(theme) => void saveChanges({ theme })} />
        </div>
      )}
    </SettingsPage>
  );
}
