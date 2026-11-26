import { useMemo } from "react";
import { useMessages } from "../../i18n";
import { usePersonalCollections } from "../../shared/personalCollections";
import { ProblemListPage, type ProblemListFilters } from "../../shared/ProblemListPage";
import type { WorkspaceViewOptions, WorkspaceViewProps } from "../../workspace/views";
import { allFavoritesTarget } from "../personal/navigationTargets";

export const workspaceView = {
  id: "favorites",
  title: "allFavorites",
  icon: "favorites",
} satisfies WorkspaceViewOptions;

const allFavoritesFilters: ProblemListFilters = { personal: { kind: "favorites" } };

function FavoriteGroupView({ groupId, title, open }: Pick<WorkspaceViewProps, "title" | "open"> & { groupId: string }) {
  const messages = useMessages();
  const { collections } = usePersonalCollections();
  const filters = useMemo<ProblemListFilters>(() => ({ personal: { kind: "favorite", id: groupId } }), [groupId]);
  const missing = collections?.every(({ id }) => id !== groupId);
  const unavailable = missing ? {
    message: messages.personalCollectionMissing,
    actionLabel: messages.allFavorites,
    target: allFavoritesTarget,
  } : undefined;

  return <ProblemListPage title={title} open={open} filters={filters} unavailable={unavailable} />;
}

export default function FavoritesView({ params, title, open }: WorkspaceViewProps) {
  return params.groupId
    ? <FavoriteGroupView groupId={params.groupId} title={title} open={open} />
    : <ProblemListPage title={title} open={open} filters={allFavoritesFilters} />;
}
