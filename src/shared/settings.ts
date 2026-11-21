import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";

const legacyThemeKey = "oi-table.theme";
const settingsChanged = "oi-table:settings-changed";

export const themes = ["system", "light", "dark"] as const;
export type Theme = (typeof themes)[number];

interface AppSettings {
  theme: Theme;
}

interface SettingsSnapshot {
  settings?: AppSettings;
  loadFailed: boolean;
}

const initialSnapshot: SettingsSnapshot = { loadFailed: false };
let snapshot = initialSnapshot;
let initialization: Promise<void> | undefined;
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
    publish({ settings: { theme: readLegacyTheme() ?? "system" }, loadFailed: false });
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

export async function updateSettings(changes: Partial<AppSettings>) {
  await (initialization ??= initializeSettings());
  if (isTauri()) {
    await invoke("update_settings", { changes });
    await refreshSettings();
  } else if (snapshot.settings) {
    publish({ settings: { ...snapshot.settings, ...changes }, loadFailed: false });
  }
}
