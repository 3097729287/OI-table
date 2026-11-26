import { useCallback, useContext, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { LocaleContext, useMessages } from "../../i18n";
import { Icon } from "../../shared/Icon";
import {
  getLibraryRevision, listLibraryArchiveChildren, listLibraryTagGroups, listProblemLibraries, localizedLibraryText,
  useLibraryRevision, type LibraryArchive, type LibraryTagGroup, type ProblemLibrary,
} from "../../shared/problemLibrary";
import { workspaceTabId, type WorkspaceTarget } from "../../workspace/layout";
import { SidebarDisclosure } from "../../workspace/SidebarDisclosure";
import type { SidebarRowProps } from "../../workspace/sidebarMenu";
import { ProblemMenuItems, useProblemMenu } from "./ProblemMenuItems";
import { archiveTarget, libraryTarget, tagGroupTarget } from "./navigationTargets";
import "./library-navigation.css";

interface NavigationProps {
  onOpen: (target: WorkspaceTarget) => void;
  selectedEntry?: string;
}

function menuIndent(depth: number): CSSProperties {
  return { "--menu-indent": `${Math.min(depth * 12, 60)}px` } as CSSProperties;
}

function useNavigationRows<Row>(load: () => Promise<Row[]>, expanded: boolean) {
  const revision = useLibraryRevision();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ revision: number; attempt: number; rows?: Row[]; failed: boolean }>();
  const settled = result?.revision === revision && result.attempt === attempt;

  useEffect(() => {
    if (!expanded || settled) return;

    let active = true;
    void load().then(
      (rows) => {
        if (active && revision === getLibraryRevision()) setResult({ revision, attempt, rows, failed: false });
      },
      () => {
        if (active && revision === getLibraryRevision()) {
          setResult((previous) => ({ revision, attempt, rows: previous?.rows, failed: true }));
        }
      },
    );
    return () => { active = false; };
  }, [attempt, expanded, load, revision, settled]);

  return {
    rows: result?.rows,
    loading: !settled && result?.rows === undefined,
    failed: settled && result.failed,
    retry: () => setAttempt((previous) => previous + 1),
  };
}

interface NavigationResultsProps<Row> {
  rows?: Row[];
  failed: boolean;
  retry: () => void;
  empty?: string;
  render: (row: Row) => ReactNode;
}

function NavigationResults<Row>({ rows, failed, retry, empty, render }: NavigationResultsProps<Row>) {
  const messages = useMessages();

  return (
    <>
      {rows?.map(render)}
      {failed && <li><button type="button" onClick={retry}>{messages.libraryNavigationLoadFailed}</button></li>}
      {!failed && rows?.length === 0 && empty && <li className="library-navigation__status">{empty}</li>}
    </>
  );
}

interface BranchRowProps extends NavigationProps {
  title: string;
  target: WorkspaceTarget;
  count?: number;
  expanded: boolean;
  listId: string;
  onToggle: () => void;
  onMenu?: (position: SidebarBranchMenuPosition) => void;
}

export interface SidebarBranchMenuPosition {
  anchor: HTMLButtonElement;
  x: number;
  y: number;
}

function BranchRow({ title, target, count, expanded, listId, onToggle, onOpen, selectedEntry, onMenu }: BranchRowProps) {
  const messages = useMessages();
  const openButton = useRef<HTMLButtonElement>(null);
  const selected = selectedEntry === workspaceTabId(target);
  const toggleLabel = messages.libraryNavigationToggle.replace("{title}", () => title);

  return (
    <div className="library-navigation__row" data-current={selected || undefined} onContextMenu={onMenu && ((event) => {
      const anchor = openButton.current;
      if (!anchor) return;
      event.preventDefault();
      onMenu({ anchor, x: event.clientX, y: event.clientY });
    })}>
      <button type="button" className="library-navigation__toggle" aria-expanded={expanded}
        aria-controls={listId} aria-label={toggleLabel} title={toggleLabel} onClick={onToggle}>
        <Icon name="chevronRight" size={15} />
      </button>
      <button ref={openButton} type="button" className="library-navigation__open" aria-current={selected || undefined}
        aria-haspopup={onMenu ? "menu" : undefined} title={title} onClick={() => onOpen(target)}
        onKeyDown={onMenu && ((event) => {
          if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
          event.preventDefault();
          const anchor = event.currentTarget;
          const { left, bottom } = anchor.getBoundingClientRect();
          onMenu({ anchor, x: left, y: bottom });
        })}>
        <span className="workbench-sidebar__label">{title}</span>
        {count !== undefined && <span className="library-navigation__count">{count}</span>}
      </button>
    </div>
  );
}

export { BranchRow as SidebarBranchRow, menuIndent as sidebarMenuIndent };

function TagBranch({ group, ...navigation }: NavigationProps & { group: LibraryTagGroup }) {
  const locale = useContext(LocaleContext);
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const target = tagGroupTarget(group);
  const query = group.id === null ? { untagged: true } : { tagId: group.id };
  const menu = useProblemMenu(query, expanded);

  return (
    <li>
      <BranchRow {...navigation} title={target.label[locale]} target={target} count={group.problemCount}
        expanded={expanded} listId={listId} onToggle={() => setExpanded((open) => !open)} />
      <SidebarDisclosure id={listId} expanded={expanded} loading={menu.initialLoading}>
        <ul className="workbench-sidebar__items" style={menuIndent(3)}>
          <ProblemMenuItems {...navigation} menu={menu} />
        </ul>
      </SidebarDisclosure>
    </li>
  );
}

export function CatalogNavigation({ depth, title, target, ...navigation }: SidebarRowProps) {
  const messages = useMessages();
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const groups = useNavigationRows(listLibraryTagGroups, expanded);

  return (
    <li>
      <BranchRow {...navigation} title={title} target={target}
        expanded={expanded} listId={listId} onToggle={() => setExpanded((open) => !open)} />
      <SidebarDisclosure id={listId} expanded={expanded} loading={groups.loading}>
        <ul className="workbench-sidebar__items" style={menuIndent(depth + 1)}>
          <NavigationResults {...groups} empty={messages.emptyWorkspace}
            render={(group) => <TagBranch {...navigation} key={group.id ?? ""} group={group} />} />
        </ul>
      </SidebarDisclosure>
    </li>
  );
}

interface ArchiveBranchProps extends NavigationProps {
  library: ProblemLibrary;
  depth: number;
  archive?: LibraryArchive;
}

function ArchiveBranch({ library, depth, archive, ...navigation }: ArchiveBranchProps) {
  const locale = useContext(LocaleContext);
  const messages = useMessages();
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const archiveId = archive?.id;
  const libraryId = library.id;
  const load = useCallback(() => listLibraryArchiveChildren(libraryId, archiveId), [libraryId, archiveId]);
  const children = useNavigationRows(load, expanded);
  const title = localizedLibraryText(archive?.name ?? library.name, locale);
  const target = archive ? archiveTarget(libraryId, archive) : libraryTarget(library);
  const hasProblems = (archive?.problemCount ?? 0) > 0;
  const menu = useProblemMenu({ libraryId, archiveId }, expanded && hasProblems);
  const loading = children.loading || (hasProblems && menu.initialLoading);

  return (
    <li>
      <BranchRow {...navigation} title={title} count={archive?.subtreeProblemCount} target={target} expanded={expanded}
        listId={listId} onToggle={() => setExpanded((open) => !open)} />
      <SidebarDisclosure id={listId} expanded={expanded} loading={loading}>
        <ul className="workbench-sidebar__items" style={menuIndent(depth + 1)}>
          <NavigationResults {...children} empty={hasProblems ? undefined : messages.noLibraryArchives}
            render={(child) => <ArchiveBranch {...navigation} key={child.id} library={library}
              archive={child} depth={depth + 1} />} />
          {hasProblems && <ProblemMenuItems {...navigation} menu={menu} />}
        </ul>
      </SidebarDisclosure>
    </li>
  );
}

async function listEnabledLibraries() {
  return (await listProblemLibraries()).filter((library) => library.status === "enabled");
}

export function ArchiveNavigation({ depth, title, target, ...navigation }: SidebarRowProps) {
  const messages = useMessages();
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const libraryArchives = target.params.filter === "libraries";
  const libraries = useNavigationRows(listEnabledLibraries, libraryArchives && expanded);
  const childDepth = depth + 1;

  return (
    <li>
      <BranchRow {...navigation} title={title} target={target} expanded={expanded}
        listId={listId} onToggle={() => setExpanded((open) => !open)} />
      <SidebarDisclosure id={listId} expanded={expanded} loading={libraryArchives && libraries.loading}>
        <ul className="workbench-sidebar__items" style={menuIndent(childDepth)}>
          {libraryArchives ? (
            <NavigationResults {...libraries} empty={messages.noEnabledLibraries}
              render={(library) => <ArchiveBranch {...navigation} key={library.id} library={library} depth={childDepth} />} />
          ) : <li className="library-navigation__status">{messages.emptyWorkspace}</li>}
        </ul>
      </SidebarDisclosure>
    </li>
  );
}
