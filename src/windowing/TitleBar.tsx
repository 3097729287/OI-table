import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { useMessages } from "../i18n";
import { Icon } from "../shared/Icon";
import { StatusMessage } from "../shared/StatusMessage";

const desktopWindow = isTauri() ? getCurrentWindow() : undefined;

interface TitleBarProps {
  title: string;
  sidebar?: { visible: boolean; toggle: () => void };
  feedback?: { state: "loading" | "error"; message: string };
}

export function TitleBar({ title, sidebar, feedback }: TitleBarProps) {
  const messages = useMessages();
  const [maximized, setMaximized] = useState(false);
  const [actionState, setActionState] = useState<"idle" | "loading" | "error">("idle");
  const [windowStateFailed, setWindowStateFailed] = useState(false);
  const maximizeLabel = maximized ? messages.restore : messages.maximize;
  const controlsDisabled = !desktopWindow || actionState === "loading";
  const sidebarLabel = sidebar?.visible ? messages.collapseSidebar : messages.expandSidebar;
  const status = actionState === "loading"
    ? { state: "loading" as const, message: messages.windowActionPending }
    : actionState === "error" || windowStateFailed
      ? { state: "error" as const, message: actionState === "error" ? messages.windowActionFailed : messages.windowStateFailed }
      : feedback;

  async function runAction(action: "minimize" | "toggleMaximize" | "close") {
    if (!desktopWindow || controlsDisabled) return;
    setActionState("loading");
    try {
      await desktopWindow[action]();
      setActionState("idle");
    } catch {
      setActionState("error");
    }
  }

  useEffect(() => {
    if (!desktopWindow) return;

    const currentWindow = desktopWindow;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let latestQuery = 0;

    async function syncMaximized() {
      const query = ++latestQuery;
      try {
        const next = await currentWindow.isMaximized();
        if (!disposed && query === latestQuery) {
          setMaximized(next);
          setWindowStateFailed(false);
        }
      } catch {
        if (!disposed && query === latestQuery) setWindowStateFailed(true);
      }
    }

    void currentWindow.onResized(() => {
      void syncMaximized();
    }).then((stop) => {
      if (disposed) {
        stop();
        return;
      }
      unlisten = stop;
      return syncMaximized();
    }).catch(() => {
      if (!disposed) setWindowStateFailed(true);
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return (
    <header className="title-bar">
      <div className="title-bar__title" data-tauri-drag-region>
        <span>{title}</span>
      </div>
      <div className="title-bar__controls" role="group" aria-label={messages.windowControls}>
        {sidebar && (
          <button type="button" className="title-bar__sidebar" title={sidebarLabel} aria-label={sidebarLabel}
            aria-expanded={sidebar.visible} aria-controls="workspace-sidebar" onClick={sidebar.toggle}>
            <Icon name={sidebar.visible ? "sidebarVisible" : "sidebarHidden"} />
          </button>
        )}
        <button type="button" aria-label={messages.minimize} title={messages.minimize} disabled={controlsDisabled}
          onClick={() => void runAction("minimize")}>
          <Icon name="minimize" size={13} />
        </button>
        <button type="button" aria-label={maximizeLabel} title={maximizeLabel} disabled={controlsDisabled}
          onClick={() => void runAction("toggleMaximize")}>
          <Icon name={maximized ? "restore" : "maximize"} size={13} />
        </button>
        <button type="button" className="title-bar__close" aria-label={messages.close} title={messages.close}
          disabled={controlsDisabled} onClick={() => void runAction("close")}>
          <Icon name="close" size={13} />
        </button>
      </div>
      {status && (
        <div className="title-bar-status">
          <StatusMessage state={status.state}>{status.message}</StatusMessage>
        </div>
      )}
    </header>
  );
}
