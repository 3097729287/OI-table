import { EditorState, RangeSet, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, keymap, lineNumberMarkers, lineNumbers } from "@codemirror/view";
import { mapBreakpointLines, sameBreakpointLines } from "./problemDraftSession";

export const setBreakpointLines = StateEffect.define<readonly number[]>();
export const setDebugLine = StateEffect.define<number | undefined>();
const toggleBreakpointLine = StateEffect.define<number>();

export const breakpointLines = StateField.define<readonly number[]>({
  create: () => [],
  compare: sameBreakpointLines,
  update(lines, transaction) {
    let next = lines;
    const replacement = transaction.effects.find((effect) => effect.is(setBreakpointLines));
    if (replacement) next = replacement.value;
    else if (transaction.docChanged) next = mapBreakpointLines(lines, transaction.startState.doc, transaction.newDoc, transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(toggleBreakpointLine)) {
        const line = effect.value;
        next = next.includes(line) ? next.filter((item) => item !== line) : [...next, line].sort((a, b) => a - b);
      }
    }
    return next;
  },
});

const currentLine = Decoration.line({ class: "cm-debug-current-line" });

export const debugLine = StateField.define<number | undefined>({
  create: () => undefined,
  update(line, transaction) {
    if (transaction.docChanged) line = undefined;
    for (const effect of transaction.effects) {
      if (effect.is(setDebugLine)) line = effect.value;
    }
    return line;
  },
  provide: (field) => EditorView.decorations.compute([field, "doc"], (state) => {
    const line = state.field(field);
    return line === undefined ? Decoration.none : Decoration.set(currentLine.range(state.doc.line(line).from));
  }),
});

class DebugGutterMarker extends GutterMarker {
  constructor(readonly elementClass: string) { super(); }
}

const breakpointMarker = new DebugGutterMarker("cm-debug-breakpoint");
const pausedMarker = new DebugGutterMarker("cm-debug-paused");

function toggleAt(view: EditorView, position: number) {
  view.dispatch({ effects: toggleBreakpointLine.of(view.state.doc.lineAt(position).number) });
  return true;
}

export function codeEditorBreakpointGutter(hint: string) {
  return [
    EditorView.editorAttributes.compute(["doc"], ({ doc }) => ({
      "data-breakpoint-space": doc.lines < 1_000 ? "wide" : doc.lines < 10_000 ? "compact" : "minimal",
    })),
    lineNumberMarkers.compute([breakpointLines, debugLine, "doc"], (state) => {
      const markers = state.field(breakpointLines).map((line) => breakpointMarker.range(state.doc.line(line).from));
      const active = state.field(debugLine);
      if (active !== undefined) markers.push(pausedMarker.range(state.doc.line(active).from));
      return RangeSet.of(markers, true);
    }),
    lineNumbers({
      domEventHandlers: {
        click: (view, block, event) => event.target instanceof HTMLElement &&
          event.target.classList.contains("cm-gutterElement") && toggleAt(view, block.from),
        pointerover: (_view, _block, event) => {
          if (event.target instanceof HTMLElement && event.target.classList.contains("cm-gutterElement")) {
            event.target.title = hint;
          }
          return false;
        },
      },
    }),
    keymap.of([{ key: "F9", run: (view) => toggleAt(view, view.state.selection.main.head) }]),
    EditorView.contentAttributes.of({ "aria-keyshortcuts": "F9" }),
  ];
}

export const codeEditorDebugReadOnly = [
  EditorState.readOnly.of(true), EditorView.editable.of(false), EditorView.contentAttributes.of({ tabindex: "0" }),
];
