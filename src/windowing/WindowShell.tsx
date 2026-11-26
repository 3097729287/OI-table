import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";
import { scheduleProblemComponentsPreload } from "../features/problem/problemComponents";
import { useSettings } from "../shared/settings";
import { getMessages, LocaleContext, useLocale } from "../i18n";
import { StatusMessage } from "../shared/StatusMessage";
import { flushAllProblemDrafts } from "../shared/ui/problemDrafts";
import { ScrollArea } from "../shared/ui/ScrollArea";
import { WorkspaceSidebar } from "../workspace/sidebar";
import { applyMainWindowOptions, currentWindow, isMainWindow } from "./routes";
import { TitleBar } from "./TitleBar";
import "./window-shell.css";

function checkpointProblemDrafts() {
  return invoke<void>("checkpoint_problem_drafts").catch(console.error);
}

export function WindowShell() {
  const { settings, loadFailed } = useSettings();
  const locale = useLocale(settings?.uiLanguage);
  const messages = getMessages(locale);
  const [configuration, setConfiguration] = useState<"ready" | "failed">();
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [windowClosing, setWindowClosing] = useState(false);
  const [draftCloseFailed, setDraftCloseFailed] = useState(false);
  const Page = currentWindow?.Page;
  const startupSettled = configuration !== undefined && (settings !== undefined || loadFailed);

  useLayoutEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useLayoutEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.style.setProperty("--ui-font-family", `var(--font-${settings.uiFont})`);
    root.style.setProperty("--ui-font-size", `${settings.uiFontSize}px`);
    root.style.setProperty("--editor-font-family", settings.editorFont === "interface"
      ? "var(--ui-font-family)"
      : `var(--font-${settings.editorFont})`);
    root.style.setProperty("--editor-font-size", settings.editorFontSizeMode === "interface"
      ? "var(--ui-font-size)"
      : `${settings.editorFontSize}px`);
  }, [settings]);

  useEffect(() => {
    let active = true;
    void applyMainWindowOptions().then(
      () => { if (active) setConfiguration("ready"); },
      () => { if (active) setConfiguration("failed"); },
    );
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (isMainWindow && startupSettled) return scheduleProblemComponentsPreload();
  }, [startupSettled]);

  useEffect(() => {
    if (!isMainWindow || !isTauri() || !startupSettled) return;
    let beforePaint = 0;
    let afterPaint = 0;

    function scheduleCheckpoint() {
      window.cancelAnimationFrame(beforePaint);
      window.cancelAnimationFrame(afterPaint);
      if (document.visibilityState !== "visible") return;
      beforePaint = window.requestAnimationFrame(() => {
        afterPaint = window.requestAnimationFrame(() => {
          document.removeEventListener("visibilitychange", scheduleCheckpoint);
          void checkpointProblemDrafts();
        });
      });
    }

    document.addEventListener("visibilitychange", scheduleCheckpoint);
    scheduleCheckpoint();
    return () => {
      document.removeEventListener("visibilitychange", scheduleCheckpoint);
      window.cancelAnimationFrame(beforePaint);
      window.cancelAnimationFrame(afterPaint);
    };
  }, [startupSettled]);

  useEffect(() => {
    if (!isMainWindow || !isTauri()) return;
    let active = true;
    let closing = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onCloseRequested(async (event) => {
      if (closing) {
        event.preventDefault();
        return;
      }
      closing = true;
      flushSync(() => {
        setWindowClosing(true);
        setDraftCloseFailed(false);
      });
      if (await flushAllProblemDrafts().catch(() => false)) {
        await checkpointProblemDrafts();
        if (await flushAllProblemDrafts().catch(() => false)) return;
      }
      event.preventDefault();
      closing = false;
      if (active) {
        setWindowClosing(false);
        setDraftCloseFailed(true);
      }
    }).then((stop) => {
      if (active) unlisten = stop;
      else stop();
    }).catch(console.error);
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  return (
    <LocaleContext value={locale}>
      <div className="window-shell">
        <TitleBar
          title={currentWindow?.title ?? "OI-table"}
          sidebar={isMainWindow ? {
            visible: sidebarVisible,
            toggle: () => setSidebarVisible((visible) => !visible),
          } : undefined}
          feedback={windowClosing ? {
            state: "loading",
            message: messages.windowActionPending,
          } : draftCloseFailed ? {
            state: "error",
            message: messages.windowDraftSaveFailed,
          } : configuration === "failed" ? {
            state: "error",
            message: messages.windowConfigurationFailed,
          } : undefined}
        />
        <ScrollArea className="window-content" inert={windowClosing}>
          {Page ? (
            <WorkspaceSidebar.Provider value={{ visible: sidebarVisible, show: () => setSidebarVisible(true) }}>
              <Page />
            </WorkspaceSidebar.Provider>
          ) : (
            <main className="workspace">
              <StatusMessage state="error">{messages.windowPageUnavailable}</StatusMessage>
            </main>
          )}
        </ScrollArea>
      </div>
    </LocaleContext>
  );
}
