import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ComponentType } from "react";

export interface WindowOptions {
  title?: string;
  size?: [width: number, height: number];
  minSize?: [width: number, height: number];
}

interface WindowModule {
  default: ComponentType;
  windowOptions?: WindowOptions;
}

const pages = import.meta.glob<WindowModule>("../windows/*/index.tsx", { eager: true });
const childLabelPrefix = "child-";
const mainRoute = "main";

const routes = new Map(Object.entries(pages).map(([path, page]) => {
  const name = path.slice("../windows/".length, -"/index.tsx".length);
  return [name, {
    name,
    Page: page.default,
    title: page.windowOptions?.title ?? (name === mainRoute ? "OI-table" : name),
    size: page.windowOptions?.size,
    minSize: page.windowOptions?.minSize,
  }] as const;
}));

export const desktop = isTauri();
const label = desktop ? getCurrentWindow().label : mainRoute;
const routeName = label.startsWith(childLabelPrefix) ? label.slice(childLabelPrefix.length) : label;
export const currentWindow = routes.get(routeName);
export const isMainWindow = label === mainRoute;

let mainWindowSetup: Promise<void> | undefined;

export async function applyMainWindowOptions() {
  if (!desktop || !isMainWindow || !currentWindow) return;
  const { title, size, minSize } = currentWindow;
  await (mainWindowSetup ??= invoke<void>("configure_main_window", { title, size, minSize }));
}

export async function openWindow(name: string) {
  const route = routes.get(name);
  if (!route || name === mainRoute) throw new Error(`Unknown child window: ${name}`);
  const { title, size, minSize } = route;
  await invoke<void>("open_window", { route: name, title, size, minSize });
}
