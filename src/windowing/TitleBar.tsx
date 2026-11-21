import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState, type ReactNode } from "react";
import { messages } from "../i18n";
import { StatusMessage } from "../shared/StatusMessage";

const desktopWindow = isTauri() ? getCurrentWindow() : undefined;

interface TitleBarProps {
  title: string;
  feedback?: { state: "loading" | "error"; message: string };
  children?: ReactNode;
}

export function TitleBar({ title, feedback, children }: TitleBarProps) {
  const [maximized, setMaximized] = useState(false);
  const [actionState, setActionState] = useState<"idle" | "loading" | "error">("idle");
  const [windowStateFailed, setWindowStateFailed] = useState(false);
  const maximizeLabel = maximized ? messages.restore : messages.maximize;
  const controlsDisabled = !desktopWindow || actionState === "loading";
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
      <div className="title-bar__title" data-tauri-drag-region>{title}</div>
      {children}
      <div className="title-bar__controls" role="group" aria-label={messages.windowControls}>
        <button type="button" aria-label={messages.minimize} title={messages.minimize} disabled={controlsDisabled}
          onClick={() => void runAction("minimize")}>
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6h10" /></svg>
        </button>
        <button type="button" aria-label={maximizeLabel} title={maximizeLabel} disabled={controlsDisabled}
          onClick={() => void runAction("toggleMaximize")}>
          <svg viewBox="0 0 12 12" aria-hidden="true">
            {maximized ? <path d="M4 3V1h7v7H9M1 4h7v7H1z" /> : <path d="M1 1h10v10H1z" />}
          </svg>
        </button>
        <button type="button" className="title-bar__close" aria-label={messages.close} title={messages.close}
          disabled={controlsDisabled} onClick={() => void runAction("close")}>
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m1 1 10 10M11 1 1 11" /></svg>
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
