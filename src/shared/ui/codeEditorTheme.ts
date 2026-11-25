import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

export const codeEditorTheme = [
  syntaxHighlighting(HighlightStyle.define([
    { tag: [tags.keyword, tags.modifier, tags.controlKeyword], color: "light-dark(#784296, #d6a8ee)" },
    { tag: [tags.typeName, tags.className, tags.namespace], color: "light-dark(#13687b, #81ced4)" },
    { tag: [tags.string, tags.regexp], color: "light-dark(#237343, #9bd6a7)" },
    { tag: [tags.number, tags.bool, tags.null], color: "light-dark(#945021, #efb081)" },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "light-dark(#245ca5, #9cbff7)" },
    { tag: [tags.comment, tags.docComment], color: "var(--muted-color)" },
    { tag: tags.meta, color: "var(--accent-color)" },
  ])),
  EditorView.theme({
    "&": { height: "100%", backgroundColor: "var(--window-background)", color: "var(--text-color)" },
    "&.cm-focused": { outline: "none", boxShadow: "inset 0 0 0 1px var(--control-border)" },
    ".cm-scroller": { fontFamily: "var(--editor-font-family)", fontSize: "var(--editor-font-size)", lineHeight: "1.6" },
    ".cm-content": { padding: "var(--space-sm) 0", caretColor: "var(--text-color)" },
    ".cm-line": { padding: "0 var(--space-sm)" },
    ".cm-gutters": {
      backgroundColor: "var(--sidebar-background)", color: "var(--muted-color)", borderRight: "1px solid var(--control-border)",
    },
    ".cm-activeLineGutter, .cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--accent-color) 8%, transparent)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "var(--navigation-selected)" },
    ".cm-placeholder": { color: "var(--muted-color)" },
    ".cm-tooltip, .cm-panels": {
      backgroundColor: "var(--sidebar-background)", color: "var(--text-color)", borderColor: "var(--control-border)",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected], .cm-panel.cm-panel-lint ul [aria-selected], .cm-panel.cm-panel-lint ul:focus [aria-selected]": {
      backgroundColor: "var(--navigation-selected)", color: "var(--text-color)",
    },
  }),
];
