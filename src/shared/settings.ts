import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";
import type { UiLanguage } from "../i18n";
import type { CodeLanguage } from "./codeLanguages";
import type { FontPreset } from "./fonts";

const legacyThemeKey = "oi-table.theme";
const settingsChanged = "oi-table:settings-changed";

export const themes = ["system", "light", "dark", "mint", "lavender"] as const;
export type Theme = (typeof themes)[number];

export interface AppSettings {
  theme: Theme;
  uiLanguage: UiLanguage;
  uiFont: FontPreset;
  uiFontSize: number;
  editorDefaultLanguage: CodeLanguage;
  editorFont: FontPreset | "interface";
  editorFontSizeMode: "custom" | "interface";
  editorFontSize: number;
  problemDoubleColumn: boolean;
  logMaxSizeMib: number;
}

interface SettingsSnapshot {
  settings?: AppSettings;
  loadFailed: boolean;
}

const initialSnapshot: SettingsSnapshot = { loadFailed: false };
let snapshot = initialSnapshot;
let initialization: Promise<void> | undefined;
let pendingUpdate = Promise.resolve();
let latestRead = 0;
const subscribers = new Set<() => void>();

function publish(next: SettingsSnapshot) {
  snapshot = next;
  for (const notify of subscribers) notify();
}

function readLegacyTheme(): Theme | undefined {
  try {
    const value = localStorage.getItem(legacyThemeKey);
    if (value === "system" || value === "light" || value === "dark") return value;
  } catch {
    // The native settings file remains available when WebView storage is disabled.
  }
}

async function refreshSettings(legacyTheme?: Theme): Promise<boolean> {
  const request = ++latestRead;
  try {
    const settings = await invoke<AppSettings>("get_settings", { legacyTheme });
    if (request === latestRead) publish({ settings, loadFailed: false });
    return true;
  } catch {
    if (request === latestRead) publish({ ...snapshot, loadFailed: true });
    return false;
  }
}

async function initializeSettings() {
  if (!isTauri()) {
    publish({ loadFailed: true });
    return;
  }

  try {
    const unlisten = await listen(settingsChanged, () => void refreshSettings());
    import.meta.hot?.dispose(unlisten);
  } catch (error) {
    console.error(error);
  }

  const legacyTheme = readLegacyTheme();
  if (await refreshSettings(legacyTheme) && legacyTheme !== undefined) {
    try {
      localStorage.removeItem(legacyThemeKey);
    } catch {
      // A subsequent launch can safely retry; the settings file takes precedence.
    }
  }
}

function subscribe(notify: () => void) {
  subscribers.add(notify);
  initialization ??= initializeSettings();
  return () => { subscribers.delete(notify); };
}

export function useSettings() {
  return useSyncExternalStore(subscribe, () => snapshot, () => initialSnapshot);
}

export function updateSettings(changes: Partial<AppSettings>) {
  const update = pendingUpdate.then(async () => {
    if (!isTauri()) throw new Error("Settings can only be saved by the desktop app");

    await (initialization ??= initializeSettings());
    await invoke("update_settings", { changes });
    await refreshSettings();
  });
  pendingUpdate = update.catch(() => {});
  return update;
}
