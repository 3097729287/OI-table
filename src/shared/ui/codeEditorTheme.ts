import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

export const codeSyntaxHighlighting = syntaxHighlighting(HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword], color: "light-dark(#784296, #d6a8ee)" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "light-dark(#13687b, #81ced4)" },
  { tag: [tags.string, tags.regexp], color: "light-dark(#237343, #9bd6a7)" },
  { tag: [tags.number, tags.bool, tags.null], color: "light-dark(#945021, #efb081)" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "light-dark(#245ca5, #9cbff7)" },
  { tag: [tags.comment, tags.docComment], color: "var(--muted-color)" },
  { tag: tags.meta, color: "var(--accent-color)" },
]));

export const codeEditorTheme = EditorView.theme({
  "&": {
    "--code-editor-caret": "light-dark(#214f6d, #eef5ff)",
    height: "100%", backgroundColor: "var(--window-background)", color: "var(--text-color)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--editor-font-family)", fontSize: "var(--editor-font-size)", lineHeight: "1.6" },
  ".cm-content": {
    padding: "var(--space-sm) 0", caretColor: "var(--code-editor-caret)", fontVariantLigatures: "contextual",
  },
  "&.cm-editor .cm-cursorLayer .cm-cursor, &.cm-editor .cm-dropCursor": {
    borderLeft: "2px solid var(--code-editor-caret)", marginLeft: "-1px",
  },
  // drawSelection hides the primary native caret and restores it for focused widgets.
  "&.cm-editor .cm-content :focus": { caretColor: "var(--code-editor-caret) !important" },
  ".cm-line": { padding: "0 var(--space-sm)" },
  ".cm-gutters": {
    backgroundColor: "var(--window-background)", color: "var(--muted-color)",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    minInlineSize: "calc(5ch + 12px)", paddingInline: "4px 8px", textAlign: "end", fontVariantNumeric: "tabular-nums",
  },
  "&.cm-editor .cm-scroller .cm-gutters.cm-gutters-before, &.cm-editor .cm-scroller .cm-gutters.cm-gutters-after": {
    border: "0",
  },
  ".cm-activeLineGutter, .cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--accent-color) 8%, transparent)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "var(--navigation-selected)" },
  ".cm-tooltip, .cm-panels": {
    backgroundColor: "var(--sidebar-background)", color: "var(--text-color)", borderColor: "var(--control-border)",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected], .cm-panel.cm-panel-lint ul [aria-selected], .cm-panel.cm-panel-lint ul:focus [aria-selected]": {
    backgroundColor: "var(--navigation-selected)", color: "var(--text-color)",
  },
});
