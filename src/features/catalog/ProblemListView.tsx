import { useContext, useEffect, useMemo, useState } from "react";
import { LocaleContext, useMessages } from "../../i18n";
import { allFavoritesTarget } from "../personal/navigationTargets";
import { getPersonalRevision, usePersonalRevision } from "../../shared/personalCollections";
import {
  getLibraryRevision, listLibraryProblems, localizedLibraryText, useLibraryRevision,
  type LibraryProblem, type LibraryProblemPage, type LibraryProblemQuery,
} from "../../shared/problemLibrary";
import { StatusMessage } from "../../shared/StatusMessage";
import { Input } from "../../shared/ui/Fields";
import { ScrollArea } from "../../shared/ui/ScrollArea";
import type { WorkspaceViewProps } from "../../workspace/views";
import { problemTarget } from "./navigationTargets";
import "./problem-list.css";

interface PageRequest {
  cursors: readonly (string | undefined)[];
}

const firstPage: PageRequest = { cursors: [undefined] };

type PageResult = { request: PageRequest; revision: number; personalRevision: number | undefined } & (
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
            const availability = item.removed ? messages.personalProblemRemoved
              : item.libraryStatus && item.libraryStatus !== "enabled" ? messages.personalProblemLibraryUnavailable : undefined;
            return (
              <tr key={item.id}>
                <td>
                  <button type="button" className="problem-list-view__title"
                    onClick={() => open(problemTarget(item.id, item.title))}>
                    {title}
                    {availability && <span className="problem-list-view__availability">{availability}</span>}
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
  const collections = usePersonalRevision();
  const personalRevision = filters.personal ? collections : undefined;
  const [pagination, setPagination] = useState<{ personalRevision: number | undefined; request: PageRequest }>();
  const request = pagination && pagination.personalRevision === personalRevision ? pagination.request : firstPage;
  const [result, setResult] = useState<PageResult>();
  const cached = result && (result.personalRevision === personalRevision || result.request.cursors.length === 1) ? result : undefined;
  const { cursors } = cached?.page ? cached.request : request;
  const pageNumber = cursors.length;
  const current = result?.request === request && result.revision === revision && result.personalRevision === personalRevision
    ? result : undefined;
  const page = cached?.page;
  const nextCursor = page?.nextCursor ?? null;
  const previousDisabled = !current || pageNumber === 1;
  const nextDisabled = !current || current.state === "error" || nextCursor === null;

  function loadPage(cursors: PageRequest["cursors"]) {
    setPagination({ personalRevision, request: { cursors } });
  }

  useEffect(() => {
    let active = true;
    const isCurrent = () => active && revision === getLibraryRevision() &&
      (personalRevision === undefined || personalRevision === getPersonalRevision());
    void listLibraryProblems({ ...filters, keyword: keyword || undefined, after: request.cursors.at(-1) }).then(
      (page) => {
        if (isCurrent()) setResult({ request, revision, personalRevision, state: "ready", page });
      },
      (error: unknown) => {
        if (isCurrent()) {
          setResult((previous) => ({ request, revision, personalRevision, state: "error", details: errorDetails(error),
            page: previous?.request === request ? previous.page : undefined }));
        }
      },
    );
    return () => { active = false; };
  }, [filters, keyword, request, revision, personalRevision]);

  return (
    <>
      {(pageNumber > 1 || nextCursor !== null) && (
        <nav className="problem-list-view__pagination" aria-label={messages.problemPagination}>
          <button type="button" className="ui-field problem-list-view__action" disabled={pageNumber === 1}
            aria-disabled={!current || undefined}
            onClick={() => { if (!previousDisabled) loadPage(cursors.slice(0, -1)); }}>
            {messages.previousPage}
          </button>
          <span role="status">{messages.pageNumber.replace("{number}", String(pageNumber))}</span>
          <button type="button" className="ui-field problem-list-view__action" disabled={nextCursor === null}
            aria-disabled={nextDisabled || undefined}
            onClick={() => {
              if (!nextDisabled && nextCursor !== null) loadPage([...cursors, nextCursor]);
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
            <button type="button" className="ui-field problem-list-view__action" onClick={() => loadPage(request.cursors)}>
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

function ProblemListPage({ filters, title, open, missingFavoriteGroup }: Pick<WorkspaceViewProps, "title" | "open"> & {
  filters: LibraryProblemQuery;
  missingFavoriteGroup?: boolean;
}) {
  const messages = useMessages();
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState({ keyword: "", submission: 0 });

  return (
    <section className="workspace workbench-page problem-list-view">
      <header className="problem-list-view__header">
        <h1>{title}</h1>
        {!missingFavoriteGroup && <form className="problem-list-view__search" role="search" onSubmit={(event) => {
          event.preventDefault();
          setSearch((current) => ({ keyword: draft.trim(), submission: current.submission + 1 }));
        }}>
          <Input className="problem-list-view__input" type="search" aria-label={messages.problemSearch}
            placeholder={messages.problemSearchPlaceholder} value={draft}
            onChange={(event) => setDraft(event.target.value)} />
          <button type="submit" className="ui-field problem-list-view__action">{messages.search}</button>
        </form>}
      </header>
      {missingFavoriteGroup ? (
        <div className="problem-list-view__error-actions">
          <StatusMessage state="empty">{messages.personalCollectionMissing}</StatusMessage>
          <button type="button" className="ui-field problem-list-view__action" onClick={() => open(allFavoritesTarget)}>
            {messages.allFavorites}
          </button>
        </div>
      ) : <ProblemResults key={search.submission} filters={filters} keyword={search.keyword} open={open} />}
    </section>
  );
}

export function ProblemListView({ id, params, title, open, missingFavoriteGroup }: WorkspaceViewProps & { missingFavoriteGroup?: boolean }) {
  const { libraryId, archiveId, tagId, untagged, groupId } = params;
  const filters = useMemo<LibraryProblemQuery>(() => {
    if (id === "favorites") return { personal: groupId ? { kind: "favorite", id: groupId } : { kind: "favorites" } };
    return { libraryId, archiveId, includeDescendants: archiveId ? true : undefined, tagId, untagged: untagged === "true" || undefined };
  }, [id, libraryId, archiveId, tagId, untagged, groupId]);

  return <ProblemListPage key={JSON.stringify(filters)} filters={filters} title={title} open={open}
    missingFavoriteGroup={missingFavoriteGroup} />;
}
