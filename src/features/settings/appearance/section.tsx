import { localeOptions, systemLanguage, t, type MessageKey, type UiLanguage } from "../../../i18n";
import { getFontOptions } from "../../../shared/fonts";
import { themes, type Theme } from "../../../shared/settings";
import { Select } from "../../../shared/ui/Fields";
import { NumberSetting } from "../NumberSetting";
import type { SettingsSectionProps } from "../view";

const themeLabels = {
  system: "themeSystem",
  light: "themeLight",
  dark: "themeDark",
  mint: "themeMint",
  lavender: "themeLavender",
} satisfies Record<Theme, MessageKey>;

export default function AppearanceSection({ settings, saving, saveChanges }: SettingsSectionProps) {
  const themeOptions = themes.map((value) => ({ value, label: t(themeLabels[value]) }));
  const fontOptions = getFontOptions();
  const languageOptions: { value: UiLanguage; label: string }[] = [
    { value: systemLanguage, label: t("uiLanguageSystem") },
    ...localeOptions,
  ];

  return (
    <>
      <div className="settings-row">
        <label id="settings-ui-language-label" htmlFor="settings-ui-language">{t("uiLanguage")}</label>
        <Select id="settings-ui-language" aria-labelledby="settings-ui-language-label"
          value={settings.uiLanguage} options={languageOptions} disabled={saving}
          onValueChange={(uiLanguage) => void saveChanges({ uiLanguage })} />
      </div>
      <div className="settings-row">
        <label id="settings-theme-label" htmlFor="settings-theme">{t("theme")}</label>
        <Select id="settings-theme" aria-labelledby="settings-theme-label"
          value={settings.theme} options={themeOptions} disabled={saving}
          onValueChange={(theme) => void saveChanges({ theme })} />
      </div>
      <div className="settings-row">
        <label id="settings-ui-font-label" htmlFor="settings-ui-font">{t("uiFont")}</label>
        <Select id="settings-ui-font" aria-labelledby="settings-ui-font-label"
          value={settings.uiFont} options={fontOptions} disabled={saving}
          onValueChange={(uiFont) => void saveChanges({ uiFont })} />
      </div>
      <NumberSetting id="settings-ui-font-size" setting="uiFontSize" label={t("uiFontSize")}
        invalidMessage={t("uiFontSizeInvalid")} min={12} max={20}
        value={settings.uiFontSize} saveChanges={saveChanges} />
    </>
  );
}
