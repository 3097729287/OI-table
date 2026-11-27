import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMessages } from "../../../../i18n";
import { Icon } from "../../../../shared/Icon";
import { pickProblemLibrarySource, type ProblemLibrarySource } from "../../../../shared/problemLibrary";
import { ErrorDetails, operationError } from "./feedback";

interface LibraryImportDialogProps {
  onClose(): void;
  onImport(path: string): Promise<void>;
}

export function LibraryImportDialog({ onClose, onImport }: LibraryImportDialogProps) {
  const messages = useMessages();
  const titleId = useId();
  const descriptionId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const dropZone = useRef<HTMLDivElement>(null);
  const running = useRef(false);
  const [path, setPath] = useState<string>();
  const [working, setWorking] = useState<"pick" | "import">();
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<ReturnType<typeof operationError>>();

  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    const listener = getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (!active || running.current) return;
      if (payload.type === "leave") {
        setDragOver(false);
        return;
      }

      // Tauri reports webview-local physical pixels; DOM bounds use CSS pixels.
      const bounds = dropZone.current?.getBoundingClientRect();
      const x = payload.position.x / window.devicePixelRatio;
      const y = payload.position.y / window.devicePixelRatio;
      const inside = Boolean(bounds && x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom);
      setDragOver(inside && payload.type !== "drop");
      if (payload.type !== "drop" || !inside) return;

      if (payload.paths.length !== 1) {
        setError({ title: "libraryManagementOneSource", detail: undefined });
        return;
      }
      setPath(payload.paths[0]);
      setError(undefined);
    }).catch((error: unknown) => {
      if (active) console.error("Could not listen for a problem library drop", error);
    });

    return () => {
      active = false;
      void listener.then((unlisten) => unlisten?.()).catch(console.error);
    };
  }, []);

  async function run(action: "pick" | "import", work: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setWorking(action);
    setDragOver(false);
    try {
      await work();
    } catch (error) {
      setError(operationError(error, action === "pick" ? "libraryManagementSelectionError" : "libraryManagementInstallError"));
    } finally {
      running.current = false;
      setWorking(undefined);
    }
  }

  function pick(source: ProblemLibrarySource) {
    void run("pick", async () => {
      if (!isTauri()) throw { code: "native_picker_unavailable" };
      const title = source === "directory" ? messages.libraryManagementPickerTitle : messages.libraryManagementZipPickerTitle;
      const picked = await pickProblemLibrarySource(source, title);
      if (picked !== null) {
        setPath(picked);
        setError(undefined);
      }
    });
  }

  function close() {
    if (!running.current) onClose();
  }

  const busy = working !== undefined;
  const importing = working === "import";
  const fileName = path?.split(/[/\\]/).filter(Boolean).at(-1) ?? path;

  return createPortal(
    <dialog ref={dialog} className="library-management__dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (path) void run("import", () => onImport(path));
      }}>
        <header className="library-management__dialog-header">
          <h2 id={titleId}>{messages.libraryManagementImport}</h2>
          <button type="button" className="library-management__dialog-close" aria-label={messages.close}
            aria-disabled={busy || undefined} onClick={close}>
            <Icon name="close" size={14} />
          </button>
        </header>
        <div className="library-management__dialog-body">
          <div ref={dropZone} className="library-management__drop-zone" data-drag-over={dragOver} data-selected={path !== undefined}>
            <span className="library-management__drop-icon"><Icon name={path ? "archive" : "catalog"} size={24} /></span>
            <div className="library-management__drop-content">
              <div aria-live="polite">
                <p className="library-management__drop-title" title={path}>
                  {path ? fileName : messages.libraryManagementDropPrompt}
                </p>
                <p id={descriptionId} className="library-management__drop-description">
                  {importing ? messages.libraryManagementInstalling
                    : path ? messages.libraryManagementSourceReady : messages.libraryManagementDropDescription}
                </p>
              </div>
              <div className="library-management__source-actions">
                <button type="button" className="ui-field library-management__button" aria-disabled={busy || undefined}
                  onClick={() => pick("directory")}>
                  <Icon name="catalog" />{messages.libraryManagementChoosePackage}
                </button>
                <button type="button" className="ui-field library-management__button" aria-disabled={busy || undefined}
                  onClick={() => pick("zip")}>
                  <Icon name="archive" />{messages.libraryManagementChooseZip}
                </button>
              </div>
            </div>
          </div>
          {error && (
            <div className="library-management__dialog-error" data-retrying={importing}>
              <p role={importing ? undefined : "alert"}>{messages[error.title]}</p>
              {error.detail && <ErrorDetails detail={error.detail} />}
            </div>
          )}
        </div>
        <footer className="library-management__dialog-footer">
          <button type="button" className="ui-field library-management__button" data-variant="quiet"
            aria-disabled={busy || undefined} onClick={close}>{messages.libraryManagementCancel}</button>
          <button type="submit" className="ui-field library-management__button" data-variant="primary"
            disabled={!path} aria-disabled={busy || undefined} aria-busy={importing || undefined}>
            {messages.libraryManagementImportConfirm}
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}
