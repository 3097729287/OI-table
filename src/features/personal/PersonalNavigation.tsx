import { useMemo, useState } from "react";
import { t } from "../../i18n";
import { ContextMenu } from "../../shared/ContextMenu";
import { collectionName, usePersonalCollections, type PersonalCollection } from "../../shared/personalCollections";
import type { LibraryProblemQuery } from "../../shared/problemLibrary";
import { SidebarBranch, type SidebarBranchMenuPosition } from "../../workspace/SidebarBranch";
import type { SidebarRowProps } from "../../workspace/sidebarMenu";
import { ProblemMenuItems, useProblemMenu } from "../catalog/ProblemMenuItems";
import { favoriteGroupTarget } from "./navigationTargets";
import { PersonalCollectionDialog } from "./PersonalCollectionDialog";

interface FavoriteGroupProps extends Omit<SidebarRowProps, "title" | "target"> {
  collection: PersonalCollection;
  onMenu(position: SidebarBranchMenuPosition): void;
}

function FavoriteGroup({ collection, depth, onMenu, ...navigation }: FavoriteGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const { id, problemCount } = collection;
  const personal = useMemo<LibraryProblemQuery["personal"]>(() => ({ kind: "favorite", id }), [id]);
  const menu = useProblemMenu({ personal }, expanded);

  return (
    <SidebarBranch {...navigation} title={collectionName(collection)} target={favoriteGroupTarget(collection)}
      count={problemCount} depth={depth} expanded={expanded} onToggle={() => setExpanded((open) => !open)}
      loading={menu.initialLoading} onMenu={collection.builtin ? undefined : onMenu}>
      {menu.page.items.length === 0 && !menu.failed && !menu.initialLoading && (
        <li className="workbench-sidebar__status">{t("problemListEmpty")}</li>
      )}
      <ProblemMenuItems {...navigation} menu={menu} />
    </SidebarBranch>
  );
}

export function FavoritesNavigation({ depth, title, target, ...navigation }: SidebarRowProps) {
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
      <SidebarBranch {...navigation} title={title} target={target}
        depth={depth} expanded={expanded} onToggle={() => setExpanded((open) => !open)} loading={loading && !collections}
        onMenu={setMenu}>
        {collections?.map((collection) => <FavoriteGroup {...navigation} key={collection.id} collection={collection} depth={depth + 1}
          onMenu={(position) => setMenu({ ...position, current: collection })} />)}
        {failed && <li><button type="button" onClick={retry}>{t("personalCollectionLoadFailed")} · {t("retry")}</button></li>}
        {!failed && collections?.length === 0 && <li className="workbench-sidebar__status">{t("personalCollectionEmpty")}</li>}
      </SidebarBranch>
      {menu && <ContextMenu x={menu.x} y={menu.y} label={t("personalCollectionActions")}
        onDismiss={(restoreFocus) => {
          setMenu(undefined);
          if (restoreFocus) menu.anchor.focus({ preventScroll: true });
        }}
        items={menu.current ? [
          { id: "rename", label: t("personalRename"), onSelect: () => openDialog("edit") },
          { id: "delete", label: t("personalDelete"), onSelect: () => openDialog("delete") },
        ] : [{ id: "create", label: t("personalCreateFavorite"), onSelect: () => openDialog("edit") }]} />}
      {dialog && <PersonalCollectionDialog {...dialog} onClose={() => setDialog(undefined)}
        onSaved={dialog.current ? (collection) => navigation.onOpen(favoriteGroupTarget(collection)) : undefined} />}
    </>
  );
}
