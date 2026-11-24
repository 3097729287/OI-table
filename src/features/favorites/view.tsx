import { useMessages } from "../../i18n";
import { StatusMessage } from "../../shared/StatusMessage";
import type { WorkspaceViewOptions, WorkspaceViewProps } from "../../workspace/views";

export const workspaceView = {
  title: "favorites",
  icon: "favorites",
  section: "favorites",
  sidebarTitle: "allFavorites",
  variants: [
    { id: "to-do", title: "favoriteToDo" },
    { id: "mistakes", title: "favoriteMistakes" },
    { id: "review", title: "favoriteReview" },
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
