import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";
import { scheduleProblemComponentsPreload } from "../features/problem/problemComponents";
import { registerShortcutScope } from "../shared/keybindings";
import { useSettings } from "../shared/settings";
import { locale, t } from "../i18n";
import { useLanguagePreference } from "../i18n/languagePreference";
import { StatusMessage } from "../shared/StatusMessage";
import { checkpointProblemDrafts, isDraftWorkspaceClosing, prepareDraftsForClose } from "../shared/ui/problemDraftSession";
import { WorkspaceSidebar } from "../workspace/sidebar";
import { applyMainWindowOptions, currentWindow, isMainWindow } from "./routes";
import { TitleBar } from "./TitleBar";
import "./window-shell.css";

export function WindowShell() {
  const { settings, loadFailed } = useSettings();
  useLanguagePreference(settings?.uiLanguage);
  const [configuration, setConfiguration] = useState<"ready" | "failed">();
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [windowClosing, setWindowClosing] = useState(false);
  const [draftCloseFailure, setDraftCloseFailure] = useState<"external" | "save">();
  const Page = currentWindow?.Page;
  const startupSettled = configuration !== undefined && (settings !== undefined || loadFailed);

  const toggleSidebar = useCallback(() => setSidebarVisible((visible) => !visible), []);
  useLayoutEffect(() => {
    if (isMainWindow && !windowClosing) {
      return registerShortcutScope(document, "workspace", { "workbench.toggleSidebar": toggleSidebar });
    }
  }, [toggleSidebar, windowClosing]);

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
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onCloseRequested(async (event) => {
      if (isDraftWorkspaceClosing()) {
        event.preventDefault();
        return;
      }
      const preparation = prepareDraftsForClose();
      flushSync(() => {
        setWindowClosing(true);
        setDraftCloseFailure(undefined);
      });
      const result = await preparation;
      if (result === "ready") return;
      event.preventDefault();
      if (active) {
        setWindowClosing(false);
        setDraftCloseFailure(result === "external" ? "external" : "save");
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
    <div className="window-shell">
      <TitleBar
        title={currentWindow?.title ?? "OI-table"}
        sidebar={isMainWindow ? {
          visible: sidebarVisible,
          toggle: toggleSidebar,
        } : undefined}
        feedback={windowClosing ? {
          state: "loading",
          message: t("windowActionPending"),
        } : draftCloseFailure ? {
          state: "error",
          message: t(draftCloseFailure === "external" ? "problemExternalEditorSyncFailed" : "windowDraftSaveFailed"),
        } : configuration === "failed" ? {
          state: "error",
          message: t("windowConfigurationFailed"),
        } : undefined}
      />
      <div className="window-content" inert={windowClosing}>
        {Page ? (
          <WorkspaceSidebar.Provider value={{ visible: sidebarVisible, show: () => setSidebarVisible(true), toggle: toggleSidebar }}>
            <Page />
          </WorkspaceSidebar.Provider>
        ) : (
          <main className="workspace">
            <StatusMessage state="error">{t("windowPageUnavailable")}</StatusMessage>
          </main>
        )}
      </div>
    </div>
  );
}
