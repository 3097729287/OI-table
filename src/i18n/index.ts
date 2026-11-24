import { createContext, useContext, useSyncExternalStore } from "react";
import en from "./en.json";
import zhCN from "./zh-CN.json";

const catalogs = {
  en,
  "zh-CN": zhCN,
} satisfies Record<string, typeof en>;

type Locale = keyof typeof catalogs;
export type MessageKey = keyof typeof en;
export const uiLanguages = ["system", "zh-CN", "en"] as const;
export type UiLanguage = (typeof uiLanguages)[number];

export function resolveLocale(preferences: readonly string[]): Locale {
  for (const language of preferences) {
    const primary = language.toLowerCase().split("-")[0];
    if (primary === "zh") return "zh-CN";
    if (primary === "en") return "en";
  }
  return "en";
}

function subscribeSystemLocale(notify: () => void) {
  window.addEventListener("languagechange", notify);
  return () => window.removeEventListener("languagechange", notify);
}

function getSystemLocale() {
  return resolveLocale(navigator.languages);
}

export function useLocale(preference: UiLanguage = "system") {
  const systemLocale = useSyncExternalStore(subscribeSystemLocale, getSystemLocale);
  return preference === "system" ? systemLocale : preference;
}

export const LocaleContext = createContext<Locale>("en");

export function getMessages(locale: Locale) {
  return catalogs[locale];
}

export function useMessages() {
  return getMessages(useContext(LocaleContext));
}
