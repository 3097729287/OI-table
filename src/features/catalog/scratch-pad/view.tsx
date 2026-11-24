import { useId, useRef } from "react";
import { useMessages } from "../../../i18n";
import { Scrollbar } from "../../../shared/ui/Scrollbar";
import type { WorkspaceViewOptions } from "../../../workspace/views";

export const workspaceView = {
  title: "editor",
  icon: "scratchPad",
  section: "catalog",
  sidebarTitle: "scratchPad",
  order: 20,
} satisfies WorkspaceViewOptions;

export default function EditorView() {
  const messages = useMessages();
  const editor = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  return (
    <section className="workspace workbench-page editor-view">
      <h1>{messages.editor}</h1>
      <div className="editor-view__input scrollbar-host">
        <textarea ref={editor} id={id} className="scrollbar-viewport" data-selectable
          aria-label={messages.scratchPad} placeholder={messages.scratchPad} spellCheck={false} />
        <Scrollbar viewport={editor} controls={id} orientation="vertical" label={messages.scrollVertically} />
      </div>
    </section>
  );
}
