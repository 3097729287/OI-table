import { useMessages } from "../../i18n";
import { StatusMessage } from "../../shared/StatusMessage";
import type { WorkspaceViewOptions, WorkspaceViewProps } from "../../workspace/views";

export const workspaceView = {
  id: "favorites",
  title: "favorites",
  icon: "favorites",
  section: "favorites",
  sidebarTitle: "allFavorites",
  variants: [
    { params: { filter: "to-do" }, title: "favoriteToDo" },
    { params: { filter: "mistakes" }, title: "favoriteMistakes" },
    { params: { filter: "review" }, title: "favoriteReview" },
  ],
  order: 40,
} satisfies WorkspaceViewOptions;

export default function FavoritesView({ title }: WorkspaceViewProps) {
  const messages = useMessages();
  return (
    <section className="workspace workbench-page">
      <h1>{title}</h1>
      <StatusMessage state="empty">{messages.emptyWorkspace}</StatusMessage>
    </section>
  );
}
