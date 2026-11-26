import { defaultKeymap, history, toggleTabFocusMode } from "@codemirror/commands";
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, lineNumbers } from "@codemirror/view";
import type { ReactNode, RefObject } from "react";
import { CodeEditorScrollbars } from "./CodeEditorScrollbars";
import { codeEditorTheme } from "./codeEditorTheme";
import "./code-editor.css";

export const codeEditorSurfaceExtensions = [
  lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), drawSelection(), history(), codeEditorTheme,
];

export const codeEditorDefaultKeymap = [
  ...defaultKeymap.filter(({ run }) => run !== toggleTabFocusMode),
  // An unhandled Escape would temporarily put CodeMirror into Tab-to-focus mode.
  { key: "Escape", preventDefault: true },
];

export function codeEditorContent(label: string) {
  return EditorView.contentAttributes.of({
    "aria-label": label, spellcheck: "false", autocapitalize: "off", autocomplete: "off",
  });
}

export function CodeEditorSurface({ mount, editor, children }: {
  mount: RefObject<HTMLDivElement | null>;
  editor?: EditorView;
  children?: ReactNode;
}) {
  return (
    <div className="code-editor__surface scrollbar-host">
      <div ref={mount} className="code-editor__mount" data-selectable />
      {editor && <CodeEditorScrollbars editor={editor} />}
      {children}
    </div>
  );
}
