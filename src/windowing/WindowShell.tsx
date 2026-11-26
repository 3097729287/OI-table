import { useEffect, useLayoutEffect, useState } from "react";
import { scheduleProblemComponentsPreload } from "../features/problem/problemComponents";
import { useSettings } from "../shared/settings";
import { getMessages, LocaleContext, useLocale } from "../i18n";
import { StatusMessage } from "../shared/StatusMessage";
import { ScrollArea } from "../shared/ui/ScrollArea";
import { WorkspaceSidebar } from "../workspace/sidebar";
import { applyMainWindowOptions, currentWindow, isMainWindow } from "./routes";
import { TitleBar } from "./TitleBar";
import "./window-shell.css";

export function WindowShell() {
  const { settings, loadFailed } = useSettings();
  const locale = useLocale(settings?.uiLanguage);
  const messages = getMessages(locale);
  const [configuration, setConfiguration] = useState<"ready" | "failed">();
  const [sidebarVisible, setSidebarVisible] = useState(true);
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

  return (
    <LocaleContext value={locale}>
      <div className="window-shell">
        <TitleBar
          title={currentWindow?.title ?? "OI-table"}
          sidebar={isMainWindow ? {
            visible: sidebarVisible,
            toggle: () => setSidebarVisible((visible) => !visible),
          } : undefined}
          feedback={configuration === "failed" ? {
            state: "error",
            message: messages.windowConfigurationFailed,
          } : undefined}
        />
        <ScrollArea className="window-content">
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
