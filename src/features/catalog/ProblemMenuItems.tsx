import { useContext, useEffect, useState } from "react";
import { LocaleContext, useMessages } from "../../i18n";
import { Icon } from "../../shared/Icon";
import { getPersonalRevision, usePersonalRevision } from "../../shared/personalCollections";
import {
  getLibraryRevision, listLibraryProblems, localizedLibraryText, useLibraryRevision,
  type LibraryProblemPage, type LibraryProblemQuery,
} from "../../shared/problemLibrary";
import { problemTarget } from "../../shared/problemTarget";
import { workspaceTabId, type WorkspaceTarget } from "../../workspace/layout";

type ProblemMenuQuery = Pick<LibraryProblemQuery, "libraryId" | "archiveId" | "tagId" | "untagged" | "personal">;

interface PageRequest {
  key: string;
  after?: string;
}

interface PageResult {
  queryKey: string;
  key: string;
  request: PageRequest | undefined;
  page: LibraryProblemPage;
  pageCount: number;
  failed: boolean;
}

const emptyPage: LibraryProblemPage = { items: [], nextCursor: null };

export function useProblemMenu({ libraryId, archiveId, tagId, untagged, personal }: ProblemMenuQuery, expanded: boolean) {
  const revision = useLibraryRevision();
  const collectionRevision = usePersonalRevision();
  const personalRevision = personal ? collectionRevision : undefined;
  const queryKey = JSON.stringify([libraryId, archiveId, tagId, untagged, personal]);
  const key = JSON.stringify([revision, personalRevision, queryKey]);
  const [request, setRequest] = useState<PageRequest>();
  const [result, setResult] = useState<PageResult>();
  const cached = result?.queryKey === queryKey ? result : undefined;
  const current = cached?.key === key ? cached : undefined;
  const currentRequest = request?.key === key ? request : undefined;
  const loading = !current || current.request !== currentRequest;
  const pageCount = cached?.pageCount || 1;

  useEffect(() => {
    if (!expanded || !loading) return;

    let active = true;
    const isCurrent = () => active && revision === getLibraryRevision() &&
      (personalRevision === undefined || personalRevision === getPersonalRevision());
    const after = currentRequest?.after;
    const filters = { libraryId, archiveId, tagId, untagged, personal };

    async function readPages() {
      let page = await listLibraryProblems({ ...filters, after });
      let loaded = 1;
      const items = [...page.items];
      // On a library refresh, rebuild the visible pages using the new cursors.
      while (isCurrent() && after === undefined && loaded < pageCount && page.nextCursor !== null) {
        page = await listLibraryProblems({ ...filters, after: page.nextCursor });
        items.push(...page.items);
        loaded += 1;
      }
      return { page: { items, nextCursor: page.nextCursor }, pageCount: loaded };
    }

    void readPages().then(
      ({ page, pageCount: loaded }) => {
        if (!isCurrent()) return;
        setResult((previous) => {
          const append = after !== undefined && previous?.key === key;
          return {
            queryKey, key, request: currentRequest, failed: false,
            page: append ? { ...page, items: [...previous.page.items, ...page.items] } : page,
            pageCount: append ? previous.pageCount + loaded : loaded,
          };
        });
      },
      () => {
        if (!isCurrent()) return;
        setResult((previous) => {
          const prior = previous?.queryKey === queryKey ? previous : undefined;
          return {
            queryKey, key, request: currentRequest, failed: true,
            page: prior?.page ?? emptyPage, pageCount: prior?.pageCount ?? 0,
          };
        });
      },
    );
    return () => { active = false; };
  }, [expanded, loading, key, queryKey, pageCount, currentRequest, libraryId, archiveId, tagId, untagged,
    personal, revision, personalRevision]);

  function loadPage() {
    if (!current || loading || (!current.failed && current.page.nextCursor === null)) return;
    const after = current.failed ? currentRequest?.after : current.page.nextCursor ?? undefined;
    setRequest({ key, after });
  }

  return {
    page: cached?.page ?? emptyPage,
    loading,
    initialLoading: !cached,
    failed: current?.failed ?? false,
    loadPage,
  };
}

interface ProblemMenuItemsProps {
  menu: ReturnType<typeof useProblemMenu>;
  onOpen: (target: WorkspaceTarget) => void;
  selectedEntry?: string;
}

export function ProblemMenuItems({ menu, onOpen, selectedEntry }: ProblemMenuItemsProps) {
  const messages = useMessages();
  const locale = useContext(LocaleContext);
  const { page, loading, failed, loadPage } = menu;

  return (
    <>
      {page.items.map((item) => {
        const target = problemTarget(item.id, item.title);
        const title = localizedLibraryText(item.title, locale) || item.id;
        return (
          <li key={item.id}>
            <button type="button" title={title} aria-current={selectedEntry === workspaceTabId(target) || undefined}
              onClick={() => onOpen(target)}>
              <Icon name="problems" size={15} />
              <span className="workbench-sidebar__label">{title}</span>
            </button>
          </li>
        );
      })}
      {(failed || page.nextCursor !== null) && (
        <li>
          <button type="button" aria-disabled={loading || undefined} onClick={loadPage}>
            {loading ? messages.libraryNavigationLoading
              : failed ? messages.libraryNavigationLoadFailed : messages.moreProblems}
          </button>
        </li>
      )}
    </>
  );
}
