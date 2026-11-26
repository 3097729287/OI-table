import { useId, useMemo, useState, type ReactNode } from "react";
import { useMessages } from "../../i18n";
import { ContextMenu } from "../../shared/ContextMenu";
import { collectionName, usePersonalCollections, type PersonalCollection } from "../../shared/personalCollections";
import type { LibraryProblemQuery } from "../../shared/problemLibrary";
import type { WorkspaceTarget } from "../../workspace/layout";
import { SidebarDisclosure } from "../../workspace/SidebarDisclosure";
import { SidebarBranchRow, sidebarMenuIndent, type SidebarBranchMenuPosition } from "../catalog/LibraryNavigation";
import { ProblemMenuItems, useProblemMenu } from "../catalog/ProblemMenuItems";
import { allFavoritesTarget, favoriteGroupTarget } from "./navigationTargets";
import { PersonalCollectionDialog } from "./PersonalCollectionDialog";

interface NavigationProps {
  onOpen(target: WorkspaceTarget): void;
  selectedEntry?: string;
}

function CollectionBranch({ title, target, count, depth, loading, expanded, onToggle, onMenu, children, ...navigation }: NavigationProps & {
  title: string;
  target: WorkspaceTarget;
  count?: number;
  depth: number;
  loading?: boolean;
  expanded: boolean;
  onToggle(): void;
  onMenu?(position: SidebarBranchMenuPosition): void;
  children: ReactNode;
}) {
  const listId = useId();

  return (
    <li>
      <SidebarBranchRow {...navigation} title={title} target={target} count={count} expanded={expanded}
        listId={listId} onToggle={onToggle} onMenu={onMenu} />
      <SidebarDisclosure id={listId} expanded={expanded} loading={loading}>
        <ul className="workbench-sidebar__items" style={sidebarMenuIndent(depth + 1)}>{children}</ul>
      </SidebarDisclosure>
    </li>
  );
}

function FavoriteGroup({ collection, onMenu, ...navigation }: NavigationProps & {
  collection: PersonalCollection;
  onMenu(position: SidebarBranchMenuPosition): void;
}) {
  const messages = useMessages();
  const [expanded, setExpanded] = useState(false);
  const { id, problemCount } = collection;
  const personal = useMemo<LibraryProblemQuery["personal"]>(() => ({ kind: "favorite", id }), [id]);
  const menu = useProblemMenu({ personal }, expanded);

  return (
    <CollectionBranch {...navigation} title={collectionName(collection, messages)} target={favoriteGroupTarget(collection)}
      count={problemCount} depth={1} expanded={expanded} onToggle={() => setExpanded((open) => !open)}
      loading={menu.initialLoading} onMenu={collection.builtin ? undefined : onMenu}>
      {menu.page.items.length === 0 && !menu.failed && !menu.initialLoading && (
        <li className="library-navigation__status">{messages.problemListEmpty}</li>
      )}
      <ProblemMenuItems {...navigation} menu={menu} />
    </CollectionBranch>
  );
}

export function FavoritesNavigation(navigation: NavigationProps) {
  const messages = useMessages();
  const [expanded, setExpanded] = useState(false);
  const { collections, loading, failed, retry } = usePersonalCollections();
  const [menu, setMenu] = useState<SidebarBranchMenuPosition & { current?: PersonalCollection }>();
  const [dialog, setDialog] = useState<{ mode: "edit" | "delete"; current?: PersonalCollection }>();

  function openDialog(mode: "edit" | "delete") {
    if (!menu) return;
    menu.anchor.focus({ preventScroll: true });
    setDialog({ mode, current: menu.current });
  }

  return (
    <>
      <CollectionBranch {...navigation} title={messages.allFavorites} target={allFavoritesTarget}
        depth={0} expanded={expanded} onToggle={() => setExpanded((open) => !open)} loading={loading && !collections}
        onMenu={setMenu}>
        {collections?.map((collection) => <FavoriteGroup {...navigation} key={collection.id} collection={collection}
          onMenu={(position) => setMenu({ ...position, current: collection })} />)}
        {failed && <li><button type="button" onClick={retry}>{messages.personalCollectionLoadFailed} · {messages.retry}</button></li>}
        {!failed && collections?.length === 0 && <li className="library-navigation__status">{messages.personalCollectionEmpty}</li>}
      </CollectionBranch>
      {menu && <ContextMenu x={menu.x} y={menu.y} label={messages.personalCollectionActions}
        onDismiss={(restoreFocus) => {
          setMenu(undefined);
          if (restoreFocus) menu.anchor.focus({ preventScroll: true });
        }}
        items={menu.current ? [
          { id: "rename", label: messages.personalRename, onSelect: () => openDialog("edit") },
          { id: "delete", label: messages.personalDelete, onSelect: () => openDialog("delete") },
        ] : [{ id: "create", label: messages.personalCreateFavorite, onSelect: () => openDialog("edit") }]} />}
      {dialog && <PersonalCollectionDialog {...dialog} onClose={() => setDialog(undefined)}
        onSaved={dialog.current ? (collection) => navigation.onOpen(favoriteGroupTarget(collection)) : undefined} />}
    </>
  );
}
