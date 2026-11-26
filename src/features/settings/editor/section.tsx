import { useMessages } from "../../../i18n";
import { codeLanguageOptions } from "../../../shared/codeLanguages";
import { useFontOptions } from "../../../shared/fonts";
import { Select } from "../../../shared/ui/Fields";
import { NumberSetting } from "../NumberSetting";
import type { SettingsSectionProps } from "../view";

export default function EditorSection({ settings, saving, saveChanges }: SettingsSectionProps) {
  const messages = useMessages();
  const presets = useFontOptions();

  const followInterface = { value: "interface", label: messages.followInterface } as const;
  const fontOptions = [followInterface, ...presets];
  const sizeModeOptions = [followInterface, { value: "custom", label: messages.editorFontSizeCustom }] as const;
  const problemLayoutOptions = [
    { value: "single", label: messages.settingsProblemSingleColumn },
    { value: "double", label: messages.settingsProblemDoubleColumn },
  ] as const;

  return (
    <>
      <div className="settings-row">
        <label id="settings-editor-language-label" htmlFor="settings-editor-language">
          {messages.editorDefaultLanguage}
        </label>
        <Select id="settings-editor-language" aria-labelledby="settings-editor-language-label"
          value={settings.editorDefaultLanguage} options={codeLanguageOptions} disabled={saving}
          onValueChange={(editorDefaultLanguage) => void saveChanges({ editorDefaultLanguage })} />
      </div>
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
      <div className="settings-row">
        <label id="settings-problem-layout-label" htmlFor="settings-problem-layout">
          {messages.settingsProblemDefaultLayout}
        </label>
        <Select id="settings-problem-layout" aria-labelledby="settings-problem-layout-label"
          value={settings.problemDoubleColumn ? "double" : "single"} options={problemLayoutOptions} disabled={saving}
          onValueChange={(layout) => void saveChanges({ problemDoubleColumn: layout === "double" })} />
      </div>
    </>
  );
}
