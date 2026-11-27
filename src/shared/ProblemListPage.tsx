import { useEffect, useState } from "react";
import { locale, t } from "../i18n";
import type { WorkspaceTarget } from "../workspace/layout";
import { getPersonalRevision, usePersonalRevision } from "./personalCollections";
import {
  getLibraryRevision, listLibraryProblems, localizedLibraryText, useLibraryRevision,
  type LibraryProblem, type LibraryProblemPage, type LibraryProblemQuery,
} from "./problemLibrary";
import { problemTarget } from "./problemTarget";
import { StatusMessage } from "./StatusMessage";
import { Input } from "./ui/Fields";
import { ScrollArea } from "./ui/ScrollArea";
import "./problem-list.css";

export type ProblemListFilters = Omit<LibraryProblemQuery, "keyword" | "after">;

interface ProblemListPageProps {
  title: string;
  filters: ProblemListFilters;
  open: (target: WorkspaceTarget) => void;
  unavailable?: { message: string; actionLabel: string; target: WorkspaceTarget };
}

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

function ProblemTable({ items, open }: { items: LibraryProblem[]; open: ProblemListPageProps["open"] }) {
  return (
    <ScrollArea className="problem-list-view__rows" orientation="vertical">
      <table className="problem-list-view__table">
        <thead>
          <tr>
            <th scope="col">{t("problemTitle")}</th>
            <th scope="col">{t("problemRating")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const title = localizedLibraryText(item.title, locale) || item.id;
            const availability = item.removed ? t("personalProblemRemoved")
              : item.libraryStatus && item.libraryStatus !== "enabled" ? t("personalProblemLibraryUnavailable") : undefined;
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
  filters: ProblemListFilters;
  keyword: string;
  open: ProblemListPageProps["open"];
}) {
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
        <nav className="problem-list-view__pagination" aria-label={t("problemPagination")}>
          <button type="button" className="ui-field problem-list-view__action" disabled={pageNumber === 1}
            aria-disabled={!current || undefined}
            onClick={() => { if (!previousDisabled) loadPage(cursors.slice(0, -1)); }}>
            {t("previousPage")}
          </button>
          <span role="status">{t("pageNumber", { number: pageNumber })}</span>
          <button type="button" className="ui-field problem-list-view__action" disabled={nextCursor === null}
            aria-disabled={nextDisabled || undefined}
            onClick={() => {
              if (!nextDisabled && nextCursor !== null) loadPage([...cursors, nextCursor]);
            }}>
            {t("nextPage")}
          </button>
        </nav>
      )}
      {!current && !page && <StatusMessage state="loading">{t("problemListLoading")}</StatusMessage>}
      {current?.state === "error" && (
        <div className="problem-list-view__error">
          <div className="problem-list-view__error-actions">
            <StatusMessage state="error">{t("problemListLoadFailed")}</StatusMessage>
            <button type="button" className="ui-field problem-list-view__action" onClick={() => loadPage(request.cursors)}>
              {t("retry")}
            </button>
          </div>
          {current.details && (
            <details data-selectable>
              <summary>{t("errorDetails")}</summary>
              <p>{current.details}</p>
            </details>
          )}
        </div>
      )}
      {page?.items.length ? <ProblemTable items={page.items} open={open} /> : current?.state === "ready" && (
        <StatusMessage state="empty">{keyword ? t("problemListNoResults") : t("problemListEmpty")}</StatusMessage>
      )}
    </>
  );
}

function ProblemListContent({ filters, title, open, unavailable }: ProblemListPageProps) {
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState({ keyword: "", submission: 0 });

  return (
    <section className="workspace workbench-page problem-list-view">
      <header className="problem-list-view__header">
        <h1>{title}</h1>
        {!unavailable && <form className="problem-list-view__search" role="search" onSubmit={(event) => {
          event.preventDefault();
          setSearch((current) => ({ keyword: draft.trim(), submission: current.submission + 1 }));
        }}>
          <Input className="problem-list-view__input" type="search" aria-label={t("problemSearch")}
            placeholder={t("problemSearchPlaceholder")} value={draft}
            onChange={(event) => setDraft(event.target.value)} />
          <button type="submit" className="ui-field problem-list-view__action">{t("search")}</button>
        </form>}
      </header>
      {unavailable ? (
        <div className="problem-list-view__error-actions">
          <StatusMessage state="empty">{unavailable.message}</StatusMessage>
          <button type="button" className="ui-field problem-list-view__action" onClick={() => open(unavailable.target)}>
            {unavailable.actionLabel}
          </button>
        </div>
      ) : <ProblemResults key={search.submission} filters={filters} keyword={search.keyword} open={open} />}
    </section>
  );
}

export function ProblemListPage(props: ProblemListPageProps) {
  return <ProblemListContent key={JSON.stringify(props.filters)} {...props} />;
}
