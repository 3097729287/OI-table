import { useEffect, useLayoutEffect, useState } from "react";
import { useSettings } from "../shared/settings";
import { messages } from "../i18n";
import { StatusMessage } from "../shared/StatusMessage";
import { WorkspaceSidebar } from "../workspace/sidebar";
import { applyMainWindowOptions, currentWindow, isMainWindow } from "./routes";
import { TitleBar } from "./TitleBar";
import "./window-shell.css";

export function WindowShell() {
  const theme = useSettings().settings?.theme;
  const [configurationFailed, setConfigurationFailed] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const Page = currentWindow?.Page;

  useLayoutEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    let active = true;
    void applyMainWindowOptions().catch(() => {
      if (active) setConfigurationFailed(true);
    });
    return () => { active = false; };
  }, []);

  return (
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
      <div className="window-content">
        {Page ? (
          <WorkspaceSidebar.Provider value={{ visible: sidebarVisible, show: () => setSidebarVisible(true) }}>
            <Page />
          </WorkspaceSidebar.Provider>
        ) : (
          <main className="workspace">
            <StatusMessage state="error">{messages.windowPageUnavailable}</StatusMessage>
          </main>
        )}
      </div>
    </div>
  );
}
