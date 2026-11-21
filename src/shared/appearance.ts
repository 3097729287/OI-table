import { isTauri } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";

const themeKey = "oi-table.theme";
const themeChanged = "oi-table:theme-changed";
const subscribers = new Set<() => void>();
let stopListening: (() => void) | undefined;
export const themes = ["system", "light", "dark"] as const;
export type Theme = (typeof themes)[number];

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(themeKey);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

function listenForThemeChanges() {
  let disposed = false;
  let unlisten: (() => void) | undefined;

  function notify() {
    for (const subscriber of subscribers) subscriber();
  }

  function onStorage(event: StorageEvent) {
    if (event.key === themeKey || event.key === null) notify();
  }

  window.addEventListener("storage", onStorage);
  window.addEventListener(themeChanged, notify);
  if (isTauri()) {
    void listen(themeChanged, notify).then((stop) => {
      if (disposed) stop();
      else {
        unlisten = stop;
        notify();
      }
    }).catch(console.error);
  }

  return () => {
    disposed = true;
    unlisten?.();
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(themeChanged, notify);
  };
}

function subscribe(onChange: () => void) {
  subscribers.add(onChange);
  stopListening ??= listenForThemeChanges();
  return () => {
    subscribers.delete(onChange);
    if (subscribers.size === 0) {
      stopListening?.();
      stopListening = undefined;
    }
  };
}

export function useTheme() {
  return useSyncExternalStore(subscribe, readTheme, readTheme);
}

export async function changeTheme(theme: Theme) {
  try {
    localStorage.setItem(themeKey, theme);
  } catch {
    return "settingsSaveFailed";
  }

  window.dispatchEvent(new Event(themeChanged));
  if (isTauri()) {
    try {
      await emit(themeChanged);
    } catch {
      return "settingsSyncFailed";
    }
  }
}
