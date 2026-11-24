import { uiLanguages, useMessages, type MessageKey, type UiLanguage } from "../../../i18n";
import { themes, uiFonts, type Theme, type UiFont } from "../../../shared/settings";
import { Select } from "../../../shared/ui/Fields";
import type { WorkspaceViewOptions, WorkspaceViewProps } from "../../../workspace/views";
import { NumberSetting } from "../NumberSetting";
import { SettingsPage } from "../SettingsPage";
import { useSettingsForm } from "../useSettingsForm";

export const workspaceView = {
  title: "appearance",
  icon: "settings",
  section: "settings",
  order: 60,
} satisfies WorkspaceViewOptions;

const themeLabels = {
  system: "themeSystem",
  light: "themeLight",
  dark: "themeDark",
} satisfies Record<Theme, MessageKey>;

const fontLabels = {
  system: "uiFontSystem",
  yahei: "uiFontYahei",
  serif: "uiFontSerif",
} satisfies Record<UiFont, MessageKey>;

const languageLabels = {
  system: "uiLanguageSystem",
  "zh-CN": "uiLanguageChinese",
  en: "uiLanguageEnglish",
} satisfies Record<UiLanguage, MessageKey>;

export default function AppearanceView({ title }: WorkspaceViewProps) {
  const messages = useMessages();
  const form = useSettingsForm();
  const { settings, saving, saveChanges } = form;
  const themeOptions = themes.map((value) => ({ value, label: messages[themeLabels[value]] }));
  const fontOptions = uiFonts.map((value) => ({ value, label: messages[fontLabels[value]] }));
  const languageOptions = uiLanguages.map((value) => ({ value, label: messages[languageLabels[value]] }));

  return (
    <SettingsPage title={title} form={form}>
      {settings && (
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
      )}
    </SettingsPage>
  );
}
