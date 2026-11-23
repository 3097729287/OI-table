import { messages } from "../../i18n";
import { StatusMessage } from "../../shared/StatusMessage";
import type { WorkspaceViewOptions, WorkspaceViewProps } from "../../workspace/views";

export const workspaceView = {
  title: messages.favorites,
  icon: "favorites",
  section: "favorites",
  sidebarTitle: messages.allFavorites,
  variants: [
    { id: "to-do", title: messages.favoriteToDo },
    { id: "mistakes", title: messages.favoriteMistakes },
    { id: "review", title: messages.favoriteReview },
  ],
  order: 40,
} satisfies WorkspaceViewOptions;

export default function FavoritesView({ title }: WorkspaceViewProps) {
  return (
    <section className="workspace workbench-page">
      <h1>{title}</h1>
      <StatusMessage state="empty">{messages.emptyWorkspace}</StatusMessage>
    </section>
  );
}
