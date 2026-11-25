import { defaultKeymap, historyKeymap, insertNewline } from "@codemirror/commands";
import { Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { useLayoutEffect, useRef, useState } from "react";
import { CodeEditorSurface, codeEditorContent, codeEditorSurfaceExtensions } from "./CodeEditorSurface";

const plainTextKeys = keymap.of([{ key: "Enter", run: insertNewline }, ...defaultKeymap, ...historyKeymap]);

interface PlainTextEditorProps {
  label: string;
  value: string;
  onChange(value: string): void;
}

export default function PlainTextEditor({ label, value, onChange }: PlainTextEditorProps) {
  const mount = useRef<HTMLDivElement>(null);
  const props = useRef({ label, value, onChange });
  const [editor, setEditor] = useState<EditorView>();
  const [localization] = useState(() => new Compartment());

  useLayoutEffect(() => { props.current = { label, value, onChange }; }, [label, value, onChange]);

  useLayoutEffect(() => {
    if (!mount.current) return;
    const initial = props.current;
    const view = new EditorView({
      parent: mount.current,
      state: EditorState.create({
        doc: initial.value,
        extensions: [
          codeEditorSurfaceExtensions,
          plainTextKeys,
          localization.of(codeEditorContent(initial.label)),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const text = update.state.doc.toString();
            if (text !== props.current.value) {
              props.current.value = text;
              props.current.onChange(text);
            }
          }),
        ],
      }),
    });
    setEditor(view);
    return () => view.destroy();
  }, [localization]);

  useLayoutEffect(() => {
    if (!editor || editor.state.doc.toString() === value) return;
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: value },
      annotations: Transaction.addToHistory.of(false),
    });
  }, [editor, value]);

  useLayoutEffect(() => {
    editor?.dispatch({ effects: localization.reconfigure(codeEditorContent(label)) });
  }, [editor, label, localization]);

  return <CodeEditorSurface mount={mount} editor={editor} />;
}
