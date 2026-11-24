import { useEffect, useLayoutEffect, useState } from "react";
import { useSettings } from "../shared/settings";
import { getMessages, LocaleContext, useLocale } from "../i18n";
import { StatusMessage } from "../shared/StatusMessage";
import { ScrollArea } from "../shared/ui/ScrollArea";
import { WorkspaceSidebar } from "../workspace/sidebar";
import { applyMainWindowOptions, currentWindow, isMainWindow } from "./routes";
import { TitleBar } from "./TitleBar";
import "./window-shell.css";

export function WindowShell() {
  const { settings } = useSettings();
  const locale = useLocale(settings?.uiLanguage);
  const messages = getMessages(locale);
  const [configurationFailed, setConfigurationFailed] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const Page = currentWindow?.Page;

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
    void applyMainWindowOptions().catch(() => {
      if (active) setConfigurationFailed(true);
    });
    return () => { active = false; };
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
          feedback={configurationFailed ? {
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
