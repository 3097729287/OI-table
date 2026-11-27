import type en from "./locales/en.json";

export const systemLanguage = "system";
declare const localeCode: unique symbol;
export type Locale = string & { readonly [localeCode]: true };
export type UiLanguage = typeof systemLanguage | Locale;
export type MessageKey = Exclude<keyof typeof en, "_meta">;

type CatalogFile = Partial<Record<MessageKey, string>> & { _meta: { name: string; fallback?: string } };
const catalogFiles = import.meta.glob<CatalogFile>("./locales/*.json", { eager: true, import: "default" });

export const localeCatalogs = new Map(Object.keys(catalogFiles).sort().map((path) => {
  const code = path.slice("./locales/".length, -".json".length);
  if (code === systemLanguage) throw new Error(`${path} uses the reserved system language code`);
  const { _meta, ...translation } = catalogFiles[path];
  const name = _meta?.name;
  if (typeof name !== "string" || !name.trim()) throw new Error(`Missing _meta.name in ${path}`);
  return [code as Locale, { name, fallback: _meta.fallback, translation }] as const;
}));
export const supportedLocales = [...localeCatalogs.keys()];
export const fallbackLocale = "en" as Locale;
export const localeOptions = Array.from(localeCatalogs, ([value, { name }]) => ({ value, label: name }));

export function isLocale(language: string | undefined): language is Locale {
  return language !== undefined && localeCatalogs.has(language as Locale);
}

const localeTags = supportedLocales.map((locale) => {
  const { language, script } = new Intl.Locale(locale).maximize();
  return { locale, tag: locale.toLowerCase(), language, script };
});
const longestTagsFirst = [...localeTags].sort((a, b) => b.tag.length - a.tag.length);

export function localizedLabels<T>(labelFor: (locale: Locale) => T): Record<Locale, T> {
  return Object.fromEntries(supportedLocales.map((locale) => [locale, labelFor(locale)])) as Record<Locale, T>;
}

function likelyScript(tag: string) {
  try {
    return new Intl.Locale(tag).maximize().script;
  } catch {
    return undefined;
  }
}

export function resolveLocale(preferences: readonly string[]): Locale {
  for (const preference of preferences) {
    const tag = preference.trim().toLowerCase().replaceAll("_", "-");
    const match = longestTagsFirst.find((entry) => tag === entry.tag || tag.startsWith(`${entry.tag}-`));
    if (match) return match.locale;

    const language = tag.split("-")[0];
    const candidates = localeTags.filter((entry) => entry.language === language);
    if (candidates.length > 1) {
      const script = likelyScript(tag);
      const sameScript = candidates.find((entry) => entry.script === script);
      if (sameScript) return sameScript.locale;
    }
    if (candidates[0]) return candidates[0].locale;
  }
  return fallbackLocale;
}
