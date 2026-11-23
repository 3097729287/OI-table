import { messages } from "../../i18n";
import { StatusMessage } from "../../shared/StatusMessage";
import type { WorkspaceViewOptions } from "../../workspace/views";

export const workspaceView = {
  title: messages.favorites,
  icon: "favorites",
  section: "favorites",
  sidebarTitle: messages.allFavorites,
  order: 40,
} satisfies WorkspaceViewOptions;

export default function FavoritesView() {
  return (
    <section className="workspace workbench-page">
      <h1>{messages.favorites}</h1>
      <StatusMessage state="empty">{messages.emptyWorkspace}</StatusMessage>
    </section>
  );
}
