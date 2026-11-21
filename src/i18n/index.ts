import en from "./en.json";
import zhCN from "./zh-CN.json";

const catalogs = {
  en,
  "zh-CN": zhCN,
} satisfies Record<string, typeof en>;

type Locale = keyof typeof catalogs;

export function resolveLocale(preferences: readonly string[]): Locale {
  for (const language of preferences) {
    const primary = language.toLowerCase().split("-")[0];
    if (primary === "zh") return "zh-CN";
    if (primary === "en") return "en";
  }
  return "en";
}

export const locale = resolveLocale(globalThis.navigator?.languages ?? []);
export const messages = catalogs[locale];
