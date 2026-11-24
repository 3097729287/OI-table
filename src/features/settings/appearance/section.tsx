import { uiLanguages, useMessages, type MessageKey, type UiLanguage } from "../../../i18n";
import { useFontOptions } from "../../../shared/fonts";
import { themes, type Theme } from "../../../shared/settings";
import { Select } from "../../../shared/ui/Fields";
import { NumberSetting } from "../NumberSetting";
import type { SettingsSectionProps } from "../view";

const themeLabels = {
  system: "themeSystem",
  light: "themeLight",
  dark: "themeDark",
} satisfies Record<Theme, MessageKey>;

const languageLabels = {
  system: "uiLanguageSystem",
  "zh-CN": "uiLanguageChinese",
  en: "uiLanguageEnglish",
} satisfies Record<UiLanguage, MessageKey>;

export default function AppearanceSection({ settings, saving, saveChanges }: SettingsSectionProps) {
  const messages = useMessages();
  const themeOptions = themes.map((value) => ({ value, label: messages[themeLabels[value]] }));
  const fontOptions = useFontOptions();
  const languageOptions = uiLanguages.map((value) => ({ value, label: messages[languageLabels[value]] }));

  return (
    <>
      <div className="settings-row">
        <label id="settings-ui-language-label" htmlFor="settings-ui-language">{messages.uiLanguage}</label>
        <Select id="settings-ui-language" aria-labelledby="settings-ui-language-label"
          value={settings.uiLanguage} options={languageOptions} disabled={saving}
          onValueChange={(uiLanguage) => void saveChanges({ uiLanguage })} />
      </div>
      <div className="settings-row">
        <label id="settings-theme-label" htmlFor="settings-theme">{messages.theme}</label>
        <Select id="settings-theme" aria-labelledby="settings-theme-label"
          value={settings.theme} options={themeOptions} disabled={saving}
          onValueChange={(theme) => void saveChanges({ theme })} />
      </div>
      <div className="settings-row">
        <label id="settings-ui-font-label" htmlFor="settings-ui-font">{messages.uiFont}</label>
        <Select id="settings-ui-font" aria-labelledby="settings-ui-font-label"
          value={settings.uiFont} options={fontOptions} disabled={saving}
          onValueChange={(uiFont) => void saveChanges({ uiFont })} />
      </div>
      <NumberSetting id="settings-ui-font-size" setting="uiFontSize" label={messages.uiFontSize}
        invalidMessage={messages.uiFontSizeInvalid} min={12} max={20}
        value={settings.uiFontSize} saveChanges={saveChanges} />
    </>
  );
}
