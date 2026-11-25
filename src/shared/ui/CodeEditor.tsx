import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput, indentUnit } from "@codemirror/language";
import {
  diagnosticCount, forceLinting, lintGutter, linter, lintKeymap, openLintPanel, setDiagnostics, setDiagnosticsEffect,
  type Diagnostic,
} from "@codemirror/lint";
import { Compartment, EditorState, type Text } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder } from "@codemirror/view";
import { isTauri } from "@tauri-apps/api/core";
import { useLayoutEffect, useRef, useState } from "react";
import { useMessages } from "../../i18n";
import { checkEditorCode } from "./codeCheck";
import { codeLanguageExtensions, codeLanguageNames, syntaxDiagnostics, type CodeLanguage } from "./codeLanguages";
import { codeEditorTheme } from "./codeEditorTheme";
import { Select } from "./Select";
import "./code-editor.css";

const defaultLanguage: CodeLanguage = "cpp";
const languages = (["cpp", "python"] as const).map((value) => ({ value, label: codeLanguageNames[value] }));
const editorExtensions = [
  lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), drawSelection(), history(), indentOnInput(), indentUnit.of("    "),
  bracketMatching(), closeBrackets(), autocompletion(), lintGutter(), codeEditorTheme,
  keymap.of([...closeBracketsKeymap, ...completionKeymap, ...historyKeymap, ...defaultKeymap, ...lintKeymap, indentWithTab]),
];

type Messages = ReturnType<typeof useMessages>;
type CheckFeedback = { tool: string } | { error: string };
type CheckedDraft = { doc: Text; diagnostics: Diagnostic[] };
type SavedDraft = { state: EditorState; scroll: ReturnType<EditorView["scrollSnapshot"]> };

function editorLocalization(messages: Messages) {
  return [
    EditorView.contentAttributes.of({
      "aria-label": messages.problemCodeDraft, spellcheck: "false", autocapitalize: "off", autocomplete: "off",
    }),
    EditorState.phrases.of({
      Diagnostics: messages.problemEditorDiagnosticList,
      "No diagnostics": messages.problemEditorNoDiagnostics,
      "close": messages.close,
    }),
    placeholder(messages.problemCodeDraftPlaceholder),
  ];
}

function editorMetrics(state: EditorState) {
  const position = state.selection.main.head;
  const line = state.doc.lineAt(position);
  return { line: line.number, column: position - line.from + 1, problems: diagnosticCount(state), length: state.doc.length };
}

function checkError(error: unknown) {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "check_failed";
}

interface CodeEditorProps {
  onRun?: (language: CodeLanguage, source: string) => void;
  running?: boolean;
}

export default function CodeEditor({ onRun, running = false }: CodeEditorProps) {
  const messages = useMessages();
  const texts = useRef(messages);
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const activeLanguage = useRef<CodeLanguage>(defaultLanguage);
  const drafts = useRef(new Map<CodeLanguage, SavedDraft>());
  const checks = useRef(new Map<CodeLanguage, CheckedDraft>());
  const [localization] = useState(() => new Compartment());
  const [language, setLanguage] = useState<CodeLanguage>(defaultLanguage);
  const [metrics, setMetrics] = useState({ line: 1, column: 1, problems: 0, length: 0 });
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState<CheckFeedback>();

  function createDraft(codeLanguage: CodeLanguage) {
    return EditorState.create({ extensions: [
      editorExtensions,
      codeLanguageExtensions(codeLanguage),
      localization.of(editorLocalization(texts.current)),
      EditorState.transactionExtender.of((transaction) => {
        if (transaction.docChanged && checks.current.get(codeLanguage)?.doc === transaction.startState.doc) {
          return { effects: setDiagnosticsEffect.of([]) };
        }
        return null;
      }),
      linter((editor) => {
        const checked = checks.current.get(codeLanguage);
        return checked?.doc === editor.state.doc
          ? checked.diagnostics
          : syntaxDiagnostics(editor.state, texts.current.problemEditorSyntaxError);
      }, {
        delay: 350,
        needsRefresh: (update) => localization.get(update.startState) !== localization.get(update.state),
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) setFeedback(undefined);
        const next = editorMetrics(update.state);
        setMetrics((previous) => previous.line === next.line && previous.column === next.column &&
          previous.problems === next.problems && previous.length === next.length ? previous : next);
      }),
    ] });
  }

  useLayoutEffect(() => {
    if (!container.current) return;
    const editor = new EditorView({ parent: container.current, state: createDraft(defaultLanguage) });
    view.current = editor;
    return () => { view.current = null; editor.destroy(); };
  }, []);

  useLayoutEffect(() => {
    texts.current = messages;
    const editor = view.current;
    if (!editor) return;
    editor.dispatch({ effects: localization.reconfigure(editorLocalization(messages)) });
    forceLinting(editor);
  }, [localization, messages]);

  function selectLanguage(next: CodeLanguage) {
    const editor = view.current;
    if (!editor || next === language) return;
    drafts.current.set(language, { state: editor.state, scroll: editor.scrollSnapshot() });
    const saved = drafts.current.get(next);
    activeLanguage.current = next;
    editor.setState(saved?.state ?? createDraft(next));
    editor.dispatch({ effects: [
      localization.reconfigure(editorLocalization(texts.current)),
      ...(saved ? [saved.scroll] : []),
    ] });
    setLanguage(next);
    setFeedback(undefined);
    setMetrics(editorMetrics(editor.state));
    forceLinting(editor);
  }

  async function checkDraft() {
    const editor = view.current;
    if (!editor || checking || editor.state.doc.length === 0) return;
    const { doc } = editor.state;
    const isCurrent = () => view.current === editor && activeLanguage.current === language && editor.state.doc === doc;
    setChecking(true);
    setFeedback(undefined);
    try {
      const report = await checkEditorCode(language, doc);
      if (!isCurrent()) return;
      checks.current.set(language, { doc, diagnostics: report.diagnostics });
      editor.dispatch(setDiagnostics(editor.state, report.diagnostics));
      setFeedback({ tool: report.tool });
    } catch (error) {
      if (isCurrent()) setFeedback({ error: checkError(error) });
    } finally {
      if (view.current === editor) setChecking(false);
    }
  }

  function feedbackText() {
    if (!feedback) return undefined;
    if ("tool" in feedback) return messages.problemEditorCheckComplete.replace("{tool}", feedback.tool);
    switch (feedback.error) {
      case "tool_unavailable": return messages.problemEditorToolUnavailable;
      case "check_timeout": return messages.problemEditorCheckTimeout;
      case "check_busy": return messages.problemEditorCheckBusy;
      case "source_too_large": return messages.problemEditorSourceTooLarge;
      default: return messages.problemEditorCheckFailed;
    }
  }

  return (
    <section className="code-editor" aria-label={messages.problemCodeDraft}>
      <header className="code-editor__bar">
        <div className="code-editor__actions">
          <Select className="code-editor__language" aria-label={messages.problemEditorLanguage}
            value={language} options={languages} onValueChange={selectLanguage} />
          {isTauri() && (
            <button type="button" className="ui-field code-editor__check" disabled={checking || metrics.length === 0}
              aria-busy={checking || undefined} onClick={() => void checkDraft()}>{messages.problemEditorCheck}</button>
          )}
          {onRun && (
            <button type="button" className="ui-field code-editor__run" disabled={running || metrics.length === 0}
              aria-busy={running || undefined} onClick={() => {
                if (view.current) onRun(activeLanguage.current, view.current.state.doc.toString());
              }}>{messages.problemRunLocal}</button>
          )}
        </div>
      </header>
      <div ref={container} className="code-editor__surface" data-selectable />
      <footer className="code-editor__status">
        <button type="button" className="code-editor__problems" data-has-problems={metrics.problems > 0}
          onClick={() => { if (view.current) openLintPanel(view.current); }}>
          {messages.problemEditorProblems.replace("{count}", String(metrics.problems))}
        </button>
        {(checking || feedback) && (
          <span role="status" className="code-editor__feedback">{checking ? messages.problemEditorChecking : feedbackText()}</span>
        )}
        <span className="code-editor__position">
          {messages.problemEditorPosition.replace("{line}", String(metrics.line)).replace("{column}", String(metrics.column))}
        </span>
      </footer>
    </section>
  );
}
