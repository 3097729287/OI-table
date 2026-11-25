import { useContext, useEffect, useMemo, useState } from "react";
import { LocaleContext, useMessages } from "../../i18n";
import {
  getLibraryRevision, listLibraryProblems, localizedLibraryText, useLibraryRevision,
  type LibraryProblem, type LibraryProblemPage, type LibraryProblemQuery,
} from "../../shared/problemLibrary";
import { StatusMessage } from "../../shared/StatusMessage";
import { Input } from "../../shared/ui/Fields";
import { ScrollArea } from "../../shared/ui/ScrollArea";
import type { WorkspaceViewOptions, WorkspaceViewProps } from "../../workspace/views";
import { problemTarget } from "./navigationTargets";
import "./problem-list.css";

export const workspaceView = {
  id: "catalog",
  title: "allProblems",
  icon: "problems",
  section: "catalog",
  sidebarTitle: "allProblems",
  sidebarGroups: [{ id: "problems", title: "catalog" }],
  order: 10,
} satisfies WorkspaceViewOptions;

interface PageRequest {
  cursors: readonly (string | undefined)[];
}

type PageResult = { request: PageRequest; revision: number } & (
  | { state: "ready"; page: LibraryProblemPage }
  | { state: "error"; details: string | undefined; page?: LibraryProblemPage }
);

function errorDetails(error: unknown) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return "code" in error && typeof error.code === "string" ? `${error.code} — ${error.message}` : error.message;
  }
}

function ProblemTable({ items, open }: { items: LibraryProblem[]; open: WorkspaceViewProps["open"] }) {
  const locale = useContext(LocaleContext);
  const messages = useMessages();
  return (
    <ScrollArea className="problem-list-view__rows" orientation="vertical">
      <table className="problem-list-view__table">
        <thead>
          <tr>
            <th scope="col">{messages.problemTitle}</th>
            <th scope="col">{messages.problemRating}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const title = localizedLibraryText(item.title, locale) || item.id;
            return (
              <tr key={item.id}>
                <td>
                  <button type="button" className="problem-list-view__title"
                    onClick={() => open(problemTarget(item.id, item.title))}>
                    {title}
                  </button>
                </td>
                <td>{item.rating}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollArea>
  );
}

function ProblemResults({ filters, keyword, open }: {
  filters: LibraryProblemQuery;
  keyword: string;
  open: WorkspaceViewProps["open"];
}) {
  const messages = useMessages();
  const revision = useLibraryRevision();
  const [request, setRequest] = useState<PageRequest>({ cursors: [undefined] });
  const [result, setResult] = useState<PageResult>();
  const { cursors } = result?.page ? result.request : request;
  const pageNumber = cursors.length;
  const current = result?.request === request && result.revision === revision ? result : undefined;
  const page = result?.page;
  const nextCursor = page?.nextCursor ?? null;
  const previousDisabled = !current || pageNumber === 1;
  const nextDisabled = !current || current.state === "error" || nextCursor === null;

  useEffect(() => {
    let active = true;
    void listLibraryProblems({ ...filters, keyword: keyword || undefined, after: request.cursors.at(-1) }).then(
      (page) => {
        if (active && revision === getLibraryRevision()) setResult({ request, revision, state: "ready", page });
      },
      (error: unknown) => {
        if (active && revision === getLibraryRevision()) {
          setResult((previous) => ({ request, revision, state: "error", details: errorDetails(error),
            page: previous?.request === request ? previous.page : undefined }));
        }
      },
    );
    return () => { active = false; };
  }, [filters, keyword, request, revision]);

  return (
    <>
      {(pageNumber > 1 || nextCursor !== null) && (
        <nav className="problem-list-view__pagination" aria-label={messages.problemPagination}>
          <button type="button" className="ui-field problem-list-view__action" disabled={pageNumber === 1}
            aria-disabled={!current || undefined}
            onClick={() => { if (!previousDisabled) setRequest({ cursors: cursors.slice(0, -1) }); }}>
            {messages.previousPage}
          </button>
          <span role="status">{messages.pageNumber.replace("{number}", String(pageNumber))}</span>
          <button type="button" className="ui-field problem-list-view__action" disabled={nextCursor === null}
            aria-disabled={nextDisabled || undefined}
            onClick={() => {
              if (!nextDisabled && nextCursor !== null) setRequest({ cursors: [...cursors, nextCursor] });
            }}>
            {messages.nextPage}
          </button>
        </nav>
      )}
      {!current && !page && <StatusMessage state="loading">{messages.problemListLoading}</StatusMessage>}
      {current?.state === "error" && (
        <div className="problem-list-view__error">
          <div className="problem-list-view__error-actions">
            <StatusMessage state="error">{messages.problemListLoadFailed}</StatusMessage>
            <button type="button" className="ui-field problem-list-view__action" onClick={() => setRequest({ cursors: request.cursors })}>
              {messages.retry}
            </button>
          </div>
          {current.details && (
            <details data-selectable>
              <summary>{messages.errorDetails}</summary>
              <p>{current.details}</p>
            </details>
          )}
        </div>
      )}
      {page?.items.length ? <ProblemTable items={page.items} open={open} /> : current?.state === "ready" && (
        <StatusMessage state="empty">{keyword ? messages.problemListNoResults : messages.problemListEmpty}</StatusMessage>
      )}
    </>
  );
}

function CatalogList({ filters, title, open }: Pick<WorkspaceViewProps, "title" | "open"> & {
  filters: LibraryProblemQuery;
}) {
  const messages = useMessages();
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState({ keyword: "", submission: 0 });

  return (
    <section className="workspace workbench-page problem-list-view">
      <header className="problem-list-view__header">
        <h1>{title}</h1>
        <form className="problem-list-view__search" role="search" onSubmit={(event) => {
          event.preventDefault();
          setSearch((current) => ({ keyword: draft.trim(), submission: current.submission + 1 }));
        }}>
          <Input className="problem-list-view__input" type="search" aria-label={messages.problemSearch}
            placeholder={messages.problemSearchPlaceholder} value={draft}
            onChange={(event) => setDraft(event.target.value)} />
          <button type="submit" className="ui-field problem-list-view__action">{messages.search}</button>
        </form>
      </header>
      <ProblemResults key={search.submission} filters={filters} keyword={search.keyword} open={open} />
    </section>
  );
}

export default function CatalogView({ params, title, open }: WorkspaceViewProps) {
  const { libraryId, archiveId, tagId } = params;
  const untagged = params.untagged === "true" || undefined;
  const filters = useMemo<LibraryProblemQuery>(() => ({
    libraryId, archiveId, includeDescendants: archiveId ? true : undefined, tagId, untagged,
  }), [libraryId, archiveId, tagId, untagged]);

  return <CatalogList key={JSON.stringify(filters)} filters={filters} title={title} open={open} />;
}
