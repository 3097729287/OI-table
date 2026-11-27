import { createInstance } from "i18next";
import { createElement, type PropsWithChildren } from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import {
  fallbackLocale, isLocale, localeCatalogs, supportedLocales,
  type Locale, type MessageKey,
} from "./languages";

export {
  fallbackLocale, localizedLabels, localeOptions, resolveLocale, systemLanguage,
  type Locale, type MessageKey, type UiLanguage,
} from "./languages";

const resources = Object.fromEntries(Array.from(localeCatalogs, ([locale, { translation }]) => [locale, { translation }]));
const fallbackLanguages = Object.fromEntries(Array.from(localeCatalogs, ([language, { fallback }]) => {
  if (language === fallbackLocale) return [language, []];

  const secondary = isLocale(fallback) && fallback !== language && fallback !== fallbackLocale;
  return [language, secondary ? [fallback, fallbackLocale] : [fallbackLocale]];
}));

const i18n = createInstance();
void i18n.use(initReactI18next).init({
  resources,
  lng: fallbackLocale,
  fallbackLng: { ...fallbackLanguages, default: [fallbackLocale] },
  supportedLngs: supportedLocales,
  load: "currentOnly",
  initAsync: false,
  keySeparator: false,
  interpolation: { escapeValue: false },
});

export function I18nProvider({ children }: PropsWithChildren) {
  return createElement(I18nextProvider, { i18n, children });
}

export function changeLocale(next: Locale) {
  if (i18n.language !== next) void i18n.changeLanguage(next);
}

function activeLocale(): Locale {
  const language = i18n.language;
  return isLocale(language) ? language : fallbackLocale;
}

export let locale = activeLocale();

i18n.on("languageChanged", () => {
  locale = activeLocale();
});

export function t(key: MessageKey, values?: Readonly<Record<string, string | number>>, language = locale): string {
  return i18n.t(key, { lng: language, replace: values });
}

export function formatDateTime(value: Date): string {
  return i18n.format(value, "datetime", locale, { dateStyle: "medium", timeStyle: "short" });
}

export function formatNumber(value: number): string {
  return i18n.format(value, "number", locale);
}
