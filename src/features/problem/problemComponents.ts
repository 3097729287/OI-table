import { createElement, use, type ComponentType } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

function preloadableComponent<Props extends object>(importModule: () => Promise<{ default: ComponentType<Props> }>) {
  let loaded: ComponentType<Props> | undefined;
  let request: Promise<ComponentType<Props>> | undefined;

  function preload() {
    return request ??= importModule().then(
      (module) => { loaded = module.default; return loaded; },
      (error: unknown) => { request = undefined; throw error; },
    );
  }

  function Component(props: Props) {
    const Loaded = loaded ?? use(preload());
    return createElement(Loaded, props);
  }

  return { Component, preload };
}

const markdown = preloadableComponent(() => import("../../shared/ui/MarkdownViewer"));
const code = preloadableComponent(() => import("../../shared/ui/CodeEditor"));
const plainText = preloadableComponent(() => import("../../shared/ui/PlainTextEditor"));

export const MarkdownViewer = markdown.Component;
export const CodeEditor = code.Component;
export const PlainTextEditor = plainText.Component;

const preloadSettleDelayMs = 1500;
const activityEvents = ["resize", "pointerdown", "keydown", "wheel"] as const;

export function scheduleProblemComponentsPreload() {
  let cancelPreload: (() => void) | undefined;

  function stop() {
    window.removeEventListener("load", start);
    document.removeEventListener("visibilitychange", schedule);
    for (const event of activityEvents) window.removeEventListener(event, schedule, true);
    cancelPreload?.();
  }

  function preloadIfVisible() {
    if (document.visibilityState !== "visible") return;
    stop();
    void Promise.allSettled([markdown.preload(), code.preload(), plainText.preload()]);
    if (isTauri()) void invoke<void>("warm_cpp_debugger").catch(() => {});
  }

  function waitForIdle() {
    if (typeof window.requestIdleCallback === "function") {
      const idle = window.requestIdleCallback(preloadIfVisible);
      cancelPreload = () => window.cancelIdleCallback(idle);
    } else {
      preloadIfVisible();
    }
  }

  function schedule() {
    cancelPreload?.();
    cancelPreload = undefined;
    if (document.visibilityState !== "visible") return;

    // Let the visible window paint before starting the quiet period.
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        const timer = window.setTimeout(waitForIdle, preloadSettleDelayMs);
        cancelPreload = () => window.clearTimeout(timer);
      });
    });
    cancelPreload = () => window.cancelAnimationFrame(frame);
  }

  function start() {
    document.addEventListener("visibilitychange", schedule);
    for (const event of activityEvents) window.addEventListener(event, schedule, { capture: true, passive: true });
    schedule();
  }

  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });

  return stop;
}
