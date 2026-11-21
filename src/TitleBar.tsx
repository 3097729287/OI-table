import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import "./title-bar.css";

const desktopWindow = isTauri() ? getCurrentWindow() : undefined;

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const maximizeLabel = maximized ? "还原" : "最大化";

  useEffect(() => {
    if (!desktopWindow) return;

    const currentWindow = desktopWindow;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let latestQuery = 0;

    async function syncMaximized() {
      const query = ++latestQuery;
      const next = await currentWindow.isMaximized();
      if (!disposed && query === latestQuery) setMaximized(next);
    }

    void currentWindow.onResized(() => {
      void syncMaximized().catch(console.error);
    }).then((stop) => {
      if (disposed) {
        stop();
        return;
      }
      unlisten = stop;
      return syncMaximized();
    }).catch(console.error);

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return (
    <header className="title-bar">
      <div className="title-bar__title" data-tauri-drag-region>OI-table</div>
      <div className="title-bar__controls" role="group" aria-label="窗口控制">
        <button type="button" aria-label="最小化" title="最小化" disabled={!desktopWindow}
          onClick={() => void desktopWindow?.minimize().catch(console.error)}>
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6h10" /></svg>
        </button>
        <button type="button" aria-label={maximizeLabel} title={maximizeLabel} disabled={!desktopWindow}
          onClick={() => void desktopWindow?.toggleMaximize().catch(console.error)}>
          <svg viewBox="0 0 12 12" aria-hidden="true">
            {maximized ? <path d="M4 3V1h7v7H9M1 4h7v7H1z" /> : <path d="M1 1h10v10H1z" />}
          </svg>
        </button>
        <button type="button" className="title-bar__close" aria-label="关闭" title="关闭"
          disabled={!desktopWindow} onClick={() => void desktopWindow?.close().catch(console.error)}>
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m1 1 10 10M11 1 1 11" /></svg>
        </button>
      </div>
    </header>
  );
}
