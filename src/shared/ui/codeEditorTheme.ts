import { syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { codeHighlighter } from "../editor/syntaxHighlighting";

export const codeSyntaxHighlighting = syntaxHighlighting(codeHighlighter);

export const codeEditorTheme = EditorView.theme({
  "&": {
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
  // drawSelection 隐藏编辑区的原生光标，聚焦输入控件时恢复主题光标颜色。
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
  ".cm-activeLineGutter, .cm-activeLine": { backgroundColor: "var(--editor-active-line-background)" },
  ".cm-selectionBackground": { backgroundColor: "var(--editor-selection-background)" },
  "&.cm-editor.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    backgroundColor: "var(--editor-focused-selection-background)",
  },
  "&.cm-focused .cm-matchingBracket": { backgroundColor: "var(--editor-matching-bracket-background)" },
  "&.cm-focused .cm-nonmatchingBracket": { backgroundColor: "var(--editor-nonmatching-bracket-background)" },
  ".cm-snippetField": { backgroundColor: "var(--editor-snippet-background)" },
  ".cm-snippetFieldPosition": { borderLeftColor: "var(--editor-snippet-position-color)" },
  ".cm-tooltip, .cm-panels": {
    backgroundColor: "var(--sidebar-background)", color: "var(--text-color)", borderColor: "var(--control-border)",
  },
  ".cm-tooltip-autocomplete > ul > completion-section": { borderBottomColor: "var(--editor-completion-section-border)" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected], .cm-panel.cm-panel-lint ul [aria-selected], .cm-panel.cm-panel-lint ul:focus [aria-selected]": {
    backgroundColor: "var(--navigation-selected)", color: "var(--text-color)",
  },
  ".cm-diagnostic-warning": { borderLeftColor: "var(--editor-diagnostic-warning-color)" },
  ".cm-lintRange-warning": {
    backgroundImage: "none",
    textDecorationLine: "underline", textDecorationStyle: "wavy", textDecorationColor: "var(--editor-diagnostic-warning-color)",
  },
  ".cm-lintRange-active": { backgroundColor: "var(--editor-active-diagnostic-background)" },
});
