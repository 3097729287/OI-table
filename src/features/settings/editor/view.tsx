import { useMessages } from "../../../i18n";
import { useFontOptions } from "../../../shared/fonts";
import { Select } from "../../../shared/ui/Fields";
import type { WorkspaceViewOptions, WorkspaceViewProps } from "../../../workspace/views";
import { NumberSetting } from "../NumberSetting";
import { SettingsPage } from "../SettingsPage";
import { useSettingsForm } from "../useSettingsForm";

export const workspaceView = {
  title: "editor",
  icon: "editor",
  section: "settings",
  order: 70,
} satisfies WorkspaceViewOptions;

export default function EditorSettingsView({ title }: WorkspaceViewProps) {
  const messages = useMessages();
  const presets = useFontOptions();
  const form = useSettingsForm();
  const { settings, saving, saveChanges } = form;

  const followInterface = { value: "interface", label: messages.followInterface } as const;
  const fontOptions = [followInterface, ...presets];
  const sizeModeOptions = [followInterface, { value: "custom", label: messages.editorFontSizeCustom }] as const;

  return (
    <SettingsPage title={title} form={form}>
      {settings && (
        <>
          <div className="settings-row">
            <label id="settings-editor-font-label" htmlFor="settings-editor-font">{messages.editorFont}</label>
            <Select id="settings-editor-font" aria-labelledby="settings-editor-font-label"
              value={settings.editorFont} options={fontOptions} disabled={saving}
              onValueChange={(editorFont) => void saveChanges({ editorFont })} />
          </div>
          <div className="settings-row">
            <label id="settings-editor-font-size-mode-label" htmlFor="settings-editor-font-size-mode">
              {messages.editorFontSizeMode}
            </label>
            <Select id="settings-editor-font-size-mode" aria-labelledby="settings-editor-font-size-mode-label"
              value={settings.editorFontSizeMode} options={sizeModeOptions} disabled={saving}
              onValueChange={(editorFontSizeMode) => void saveChanges({ editorFontSizeMode })} />
          </div>
          {settings.editorFontSizeMode === "custom" && (
            <NumberSetting id="settings-editor-font-size" setting="editorFontSize" label={messages.editorFontSize}
              invalidMessage={messages.editorFontSizeInvalid} min={8} max={40}
              value={settings.editorFontSize} saveChanges={saveChanges} />
          )}
        </>
      )}
    </SettingsPage>
  );
}
