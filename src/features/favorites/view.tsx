import { usePersonalCollections } from "../../shared/personalCollections";
import type { WorkspaceViewOptions, WorkspaceViewProps } from "../../workspace/views";
import { ProblemListView } from "../catalog/ProblemListView";

export const workspaceView = {
  id: "favorites",
  title: "allFavorites",
  icon: "favorites",
  section: "favorites",
  sidebarTitle: "allFavorites",
  order: 40,
} satisfies WorkspaceViewOptions;

function FavoriteGroupView(props: WorkspaceViewProps) {
  const { collections } = usePersonalCollections();
  const missingFavoriteGroup = collections?.every(({ id }) => id !== props.params.groupId);
  return <ProblemListView {...props} missingFavoriteGroup={missingFavoriteGroup} />;
}

export default function FavoritesView(props: WorkspaceViewProps) {
  return props.params.groupId ? <FavoriteGroupView {...props} /> : <ProblemListView {...props} />;
}
