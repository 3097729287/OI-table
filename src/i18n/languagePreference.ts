import { invoke, isTauri } from "@tauri-apps/api/core";
import { useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";
import { changeLocale, resolveLocale, systemLanguage, type UiLanguage } from "./index";

function browserLanguages(browser: Window): string[] {
  const { languages, language } = browser.navigator;
  return [...(languages ?? []), ...(language ? [language] : [])];
}

function watchSystemLanguages(onChange: (preferences: readonly string[]) => void) {
  if (typeof window === "undefined") return;

  const browser = window;
  const desktop = isTauri();
  let revision = 0;

  function refresh() {
    if (!desktop) {
      onChange(browserLanguages(browser));
      return;
    }

    const request = ++revision;
    void invoke<string[]>("get_system_languages").catch(() => []).then((nativeLanguages) => {
      if (request === revision) onChange([...nativeLanguages, ...browserLanguages(browser)]);
    });
  }

  browser.addEventListener("languagechange", refresh);
  if (desktop) browser.addEventListener("focus", refresh);
  refresh();

  return () => {
    revision++;
    browser.removeEventListener("languagechange", refresh);
    if (desktop) browser.removeEventListener("focus", refresh);
  };
}

export function useLanguagePreference(preference: UiLanguage = systemLanguage) {
  // Subscribe at the window root so its children re-render when the language changes.
  useTranslation();

  useLayoutEffect(() => {
    if (preference === systemLanguage) {
      return watchSystemLanguages((preferences) => changeLocale(resolveLocale(preferences)));
    }
    changeLocale(preference);
  }, [preference]);
}
