import { messages } from "../../i18n";
import type { WorkspaceViewOptions } from "../../workspace/views";

export const workspaceView = {
  title: messages.editor,
  icon: "scratchPad",
  section: "editor",
  sidebarTitle: messages.scratchPad,
  order: 20,
} satisfies WorkspaceViewOptions;

export default function EditorView() {
  return (
    <section className="workspace workbench-page editor-view">
      <h1>{messages.editor}</h1>
      <textarea data-selectable aria-label={messages.scratchPad} placeholder={messages.scratchPad} spellCheck={false} />
    </section>
  );
}
