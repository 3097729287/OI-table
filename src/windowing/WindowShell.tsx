import { useEffect, useLayoutEffect, useState } from "react";
import { useTheme } from "../shared/appearance";
import { messages } from "../i18n";
import { StatusMessage } from "../shared/StatusMessage";
import { applyMainWindowOptions, currentWindow, desktop, isMainWindow, openWindow, toolbarWindows } from "./routes";
import { TitleBar } from "./TitleBar";
import "./window-shell.css";

export function WindowShell() {
  const theme = useTheme();
  const [opening, setOpening] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const [configurationFailed, setConfigurationFailed] = useState(false);
  const Page = currentWindow?.Page;

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    let active = true;
    void applyMainWindowOptions().catch(() => {
      if (active) setConfigurationFailed(true);
    });
    return () => { active = false; };
  }, []);

  async function openChildWindow(name: string) {
    setOpening(true);
    setOpenFailed(false);
    try {
      await openWindow(name);
    } catch {
      setOpenFailed(true);
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="window-shell">
      <TitleBar
        title={currentWindow?.title ?? "OI-table"}
        feedback={openFailed || configurationFailed ? {
          state: "error",
          message: openFailed ? messages.windowOpenFailed : messages.windowConfigurationFailed,
        } : undefined}
      >
        {isMainWindow && toolbarWindows.map(({ name, title }) => (
          <button key={name} type="button" className="title-bar__action" disabled={!desktop || opening}
            onClick={() => void openChildWindow(name)}>
            {title}
          </button>
        ))}
      </TitleBar>
      <div className="window-content">
        {Page ? <Page /> : (
          <main className="workspace">
            <StatusMessage state="error">{messages.windowPageUnavailable}</StatusMessage>
          </main>
        )}
      </div>
    </div>
  );
}
