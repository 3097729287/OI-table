import { EditorState, RangeSet, StateEffect, StateField, type Transaction } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, keymap, lineNumberMarkers, lineNumbers } from "@codemirror/view";

export const setBreakpointLines = StateEffect.define<readonly number[]>();
export const setDebugLine = StateEffect.define<number | undefined>();
const toggleBreakpointLine = StateEffect.define<number>();

export function normalizeBreakpointLines(lines: readonly number[], lineCount: number) {
  return [...new Set(lines.filter((line) => Number.isInteger(line) && line >= 1 && line <= lineCount))]
    .sort((left, right) => left - right);
}

export function sameBreakpointLines(left: readonly number[], right: readonly number[]) {
  return left.length === right.length && left.every((line, index) => line === right[index]);
}

function mapBreakpointLines(lines: readonly number[], { changes, startState, newDoc }: Transaction) {
  return normalizeBreakpointLines(lines.flatMap((number) => {
    const { from, to } = startState.doc.line(number);
    // Drop a deleted line with its newline. Otherwise follow its original start through edits.
    const start = number < startState.doc.lines ? from : from - 1;
    const end = Math.min(to + 1, startState.doc.length);
    if (start >= 0 && changes.mapPos(start, -1) === changes.mapPos(end, 1)) return [];
    return [newDoc.lineAt(changes.mapPos(from, 1)).number];
  }), newDoc.lines);
}

export const breakpointLines = StateField.define<readonly number[]>({
  create: () => [],
  compare: sameBreakpointLines,
  update(lines, transaction) {
    let next = transaction.docChanged ? mapBreakpointLines(lines, transaction) : lines;
    for (const effect of transaction.effects) {
      if (effect.is(setBreakpointLines)) next = effect.value;
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
