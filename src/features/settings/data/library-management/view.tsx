import { useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LocaleContext, useMessages, type MessageKey } from "../../../../i18n";
import { Icon } from "../../../../shared/Icon";
import {
  getLibraryRevision, importProblemLibrariesFromPath, listProblemLibraries, localizedLibraryText, setProblemLibraryEnabled,
  uninstallProblemLibrary, useLibraryRevision, type ProblemLibrary, type ProblemLibraryImport,
} from "../../../../shared/problemLibrary";
import { StatusMessage } from "../../../../shared/StatusMessage";
import type { WorkspaceViewOptions, WorkspaceViewProps } from "../../../../workspace/views";
import { ErrorDetails, format, operationError } from "./feedback";
import { LibraryImportDialog } from "./LibraryImportDialog";
import { LibraryTable } from "./LibraryTable";
import "./library-management.css";

export const workspaceView = {
  id: "library-management",
  title: "libraryManagement",
  icon: "catalog",
  singleton: true,
} satisfies WorkspaceViewOptions;

type RowAction = "enable" | "disable" | "uninstall";
type Operation = { action: RowAction; libraryId: string };

type LibraryList = { request: string } & (
  | { state: "ready"; libraries: ProblemLibrary[] }
  | { state: "error"; error: unknown; libraries?: ProblemLibrary[] }
);

type Feedback =
  | { state: "success"; message: MessageKey; values: Record<string, string | number> }
  | { state: "import"; results: (ProblemLibraryImport & { message: MessageKey })[] }
  | { state: "error"; message: MessageKey; error: unknown };

const operationSuccess: Record<RowAction, MessageKey> = {
  enable: "libraryManagementEnabledResult",
  disable: "libraryManagementDisabledResult",
  uninstall: "libraryManagementUninstalledResult",
};

function Failure({ error, message, onRetry }: { error: unknown; message: MessageKey; onRetry?: () => void }) {
  const messages = useMessages();
  const { title, detail } = operationError(error, message);
  return (
    <div className="library-management__empty">
      <StatusMessage state="error">{messages[title]}</StatusMessage>
      {detail && <ErrorDetails detail={detail} />}
      {onRetry && (
        <button type="button" className="ui-field library-management__button" data-variant="quiet" onClick={onRetry}>
          {messages.libraryManagementRetry}
        </button>
      )}
    </div>
  );
}

function LibraryNotification({ feedback, onClose }: { feedback?: Feedback; onClose(): void }) {
  const messages = useMessages();
  const locale = useContext(LocaleContext);
  const resultTitle = ({ library, message }: ProblemLibraryImport & { message: MessageKey }) =>
    format(messages[message], { name: localizedLibraryText(library.name, locale) || library.id, version: library.releaseVersion });
  let title = "";
  let detail: string | undefined;

  if (feedback?.state === "error") {
    const error = operationError(feedback.error, feedback.message);
    title = messages[error.title];
    detail = error.detail;
  } else if (feedback?.state === "success") {
    title = format(messages[feedback.message], feedback.values);
  } else if (feedback?.state === "import") {
    title = feedback.results.length === 1 ? resultTitle(feedback.results[0])
      : format(messages.libraryManagementBatchImported, { count: feedback.results.length });
  }

  return createPortal(
    <div className="library-management__toasts">
      <div className="library-management__announcement" role="status">{feedback?.state !== "error" && title}</div>
      <div className="library-management__announcement" role="alert">{feedback?.state === "error" && title}</div>
      {feedback && (
        <aside className="library-management__toast" data-state={feedback.state} aria-label={title}>
          <div className="library-management__toast-head">
            <p>{title}</p>
            <button type="button" className="library-management__toast-close" aria-label={messages.close} onClick={onClose}>
              <Icon name="close" size={12} />
            </button>
          </div>
          {detail && <div className="library-management__toast-details"><ErrorDetails detail={detail} /></div>}
          {feedback.state === "import" && (
            <details className="library-management__toast-details">
              <summary>{messages.libraryManagementImportDetails}</summary>
              <ul className="library-management__import-results" role="list">
                {feedback.results.map((result) => (
                  <li key={result.library.id}>
                    {feedback.results.length > 1 && <p>{resultTitle(result)}</p>}
                    <p className="library-management__hint">{format(messages.libraryManagementImportSummary, {
                      inserted: result.inserted, updated: result.updated, restored: result.restored,
                      removed: result.removed, unchanged: result.unchanged,
                    })}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </aside>
      )}
    </div>,
    document.body,
  );
}

export default function LibraryManagementView({ title }: WorkspaceViewProps) {
  const messages = useMessages();
  const locale = useContext(LocaleContext);
  const revision = useLibraryRevision();
  const operationRunning = useRef(false);
  const [pending, setPending] = useState<Operation>();
  const [importOpen, setImportOpen] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();
  const [retry, setRetry] = useState(0);
  const [list, setList] = useState<LibraryList>();
  const request = `${revision}:${retry}`;
  const current = list?.request === request ? list : undefined;
  const libraries = list?.libraries ?? [];
  const loading = list?.libraries === undefined && current === undefined;
  const libraryName = (library: ProblemLibrary) => localizedLibraryText(library.name, locale) || library.id;

  useEffect(() => {
    let active = true;
    void listProblemLibraries().then(
      (libraries) => {
        if (active && revision === getLibraryRevision()) setList({ request, state: "ready", libraries });
      },
      (error) => {
        if (active && revision === getLibraryRevision()) {
          setList((previous) => ({ request, state: "error", error, libraries: previous?.libraries }));
        }
      },
    );
    return () => { active = false; };
  }, [request, revision]);

  async function run(operation: Operation, work: () => Promise<Feedback>) {
    if (operationRunning.current) return;
    operationRunning.current = true;
    setPending(operation);
    try {
      setFeedback(await work());
    } catch (error) {
      setFeedback({ state: "error", message: "libraryManagementActionError", error });
    } finally {
      operationRunning.current = false;
      setPending(undefined);
    }
  }

  function updateLibraries(updates: readonly ProblemLibrary[]) {
    const updatedRequest = `${getLibraryRevision()}:${retry}`;
    setList((previous) => {
      const byId = new Map(previous?.libraries?.map((library) => [library.id, library]));
      for (const library of updates) byId.set(library.id, library);
      const libraries = [...byId.keys()].sort().map((id) => byId.get(id)!);
      return { request: updatedRequest, state: "ready", libraries };
    });
  }

  async function importPackage(path: string) {
    const results = await importProblemLibrariesFromPath(path);
    if (results.length > 0) {
      const previousById = new Map(libraries.map((library) => [library.id, library]));
      updateLibraries(results.map((result) => result.library));
      setFeedback({
        state: "import",
        results: results.map((result) => {
          const previous = previousById.get(result.library.id);
          const message = previous?.status === "uninstalled" ? "libraryManagementReinstalled"
            : result.replayed ? "libraryManagementAlreadyInstalled"
            : previous ? "libraryManagementUpdated" : "libraryManagementInstalled";
          return { ...result, message };
        }),
      });
    }
    setImportOpen(false);
  }

  function changeStatus(library: ProblemLibrary, action: RowAction) {
    void run({ action, libraryId: library.id }, async () => {
      const result = action === "uninstall"
        ? await uninstallProblemLibrary(library.id)
        : await setProblemLibraryEnabled(library.id, action === "enable");
      updateLibraries([result]);
      return { state: "success", message: operationSuccess[action], values: { name: libraryName(result) } };
    });
  }

  return (
    <section className="workspace workbench-page library-management">
      <header className="library-management__header">
        <h1 className="library-management__heading">{title}</h1>
        <button type="button" className="ui-field library-management__button" data-variant="primary"
          aria-disabled={pending !== undefined || undefined}
          onClick={() => { if (!operationRunning.current) setImportOpen(true); }}>
          {messages.libraryManagementImport}
        </button>
      </header>
      <div className="library-management__section" aria-busy={loading}>
        {libraries.length > 0 ? (
          <LibraryTable libraries={libraries} pending={pending}
            onSetEnabled={(library, enabled) => changeStatus(library, enabled ? "enable" : "disable")}
            onUninstall={(library) => changeStatus(library, "uninstall")} />
        ) : current?.state === "error" ? (
          <Failure error={current.error} message="libraryManagementLoadFailed" onRetry={() => setRetry((attempt) => attempt + 1)} />
        ) : (
          <div className="library-management__empty">
            <span className="library-management__empty-icon"><Icon name="catalog" size={24} /></span>
            {loading ? <StatusMessage state="loading">{messages.libraryManagementLoading}</StatusMessage>
              : <StatusMessage state="empty">{messages.libraryManagementEmpty}</StatusMessage>}
          </div>
        )}
      </div>
      {importOpen && <LibraryImportDialog onClose={() => setImportOpen(false)} onImport={importPackage} />}
      <LibraryNotification feedback={feedback} onClose={() => setFeedback(undefined)} />
    </section>
  );
}
