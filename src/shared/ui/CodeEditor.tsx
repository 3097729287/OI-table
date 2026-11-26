import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput, indentUnit } from "@codemirror/language";
import {
  diagnosticCount, forceLinting, linter, lintKeymap, openLintPanel,
} from "@codemirror/lint";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useMessages } from "../../i18n";
import { Icon } from "../Icon";
import { DelayedLoadingMessage, StatusMessage } from "../StatusMessage";
import { codeLanguageExtensions, codeLanguageNames, syntaxDiagnostics, type CodeLanguage } from "./codeLanguages";
import { codeSyntaxHighlighting } from "./codeEditorTheme";
import { breakpointLines, codeEditorBreakpointGutter, codeEditorDebugReadOnly, debugLine as debugLineField,
  normalizeBreakpointLines, sameBreakpointLines, setBreakpointLines, setDebugLine } from "./codeEditorDebug";
import { CodeEditorSurface, codeEditorContent, codeEditorDefaultKeymap, codeEditorSurfaceExtensions } from "./CodeEditorSurface";
import { flushProblemDraft, loadProblemDraft, problemDraftSaveStatus, queueProblemDraft, subscribeToProblemDraft } from "./problemDrafts";
import { Select } from "./Select";

const defaultLanguage: CodeLanguage = "cpp";
const languages = (["cpp", "python"] as const).map((value) => ({ value, label: codeLanguageNames[value] }));
const editorExtensions = [
  codeEditorSurfaceExtensions, indentOnInput(), indentUnit.of("    "),
  bracketMatching(), closeBrackets(), autocompletion(), codeSyntaxHighlighting,
  keymap.of([...closeBracketsKeymap, ...completionKeymap, ...historyKeymap, ...codeEditorDefaultKeymap, ...lintKeymap, indentWithTab]),
];

type Messages = ReturnType<typeof useMessages>;
type SavedDraft = { state: EditorState; scroll: ReturnType<EditorView["scrollSnapshot"]> };

function editorLocalization(messages: Messages, debugEnabled: boolean) {
  return [
    codeEditorContent(messages.problemCodeDraft),
    debugEnabled ? codeEditorBreakpointGutter(`${messages.problemDebugToggleBreakpoint} (F9)`) : [],
    EditorState.phrases.of({
      Diagnostics: messages.problemEditorDiagnosticList,
      "No diagnostics": messages.problemEditorNoDiagnostics,
      "close": messages.close,
    }),
  ];
}

function editorMetrics(state: EditorState) {
  const position = state.selection.main.head;
  const line = state.doc.lineAt(position);
  return { line: line.number, column: position - line.from + 1, problems: diagnosticCount(state), length: state.doc.length };
}

interface CodeEditorProps {
  problemId: string;
  onRun?: (language: CodeLanguage, source: string) => void;
  running?: boolean;
  onDebug?: (language: CodeLanguage, source: string, breakpoints: number[]) => void;
  breakpoints?: Partial<Record<CodeLanguage, readonly number[]>>;
  onBreakpointsChange?: (language: CodeLanguage, breakpoints: number[]) => void;
  debugLine?: number;
  debugRevealKey?: number;
  debugReadOnly?: boolean;
  debugUnavailable?: boolean;
}

export default function CodeEditor({ problemId, onRun, running = false, onDebug, breakpoints, onBreakpointsChange,
  debugLine, debugRevealKey, debugReadOnly = false, debugUnavailable = false }: CodeEditorProps) {
  const messages = useMessages();
  const texts = useRef(messages);
  const debugEnabled = onDebug !== undefined;
  const debugBindings = useRef({ debugEnabled, debugReadOnly, breakpoints, onBreakpointsChange });
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const drafts = useRef(new Map<CodeLanguage, SavedDraft>());
  const sources = useRef({ cpp: "", python: "" });
  const [localization] = useState(() => new Compartment());
  const [editability] = useState(() => new Compartment());
  const [language, setLanguage] = useState<CodeLanguage>(defaultLanguage);
  const [metrics, setMetrics] = useState({ line: 1, column: 1, problems: 0, length: 0 });
  const [mountedEditor, setMountedEditor] = useState<EditorView>();
  const [loadState, setLoadState] = useState<"loading" | "ready" | "failed">("loading");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const subscribe = useCallback((listener: () => void) => subscribeToProblemDraft(problemId, listener), [problemId]);
  const saveStatus = useSyncExternalStore(subscribe, () => problemDraftSaveStatus(problemId));
  const problemsLabel = messages.problemEditorProblems.replace("{count}", String(metrics.problems));

  function createDraft(codeLanguage: CodeLanguage) {
    return EditorState.create({ doc: sources.current[codeLanguage], extensions: [
      editorExtensions,
      codeLanguageExtensions(codeLanguage),
      breakpointLines.init((state) => normalizeBreakpointLines(debugBindings.current.breakpoints?.[codeLanguage] ?? [], state.doc.lines)),
      debugLineField,
      localization.of(editorLocalization(texts.current, debugBindings.current.debugEnabled)),
      editability.of(debugBindings.current.debugReadOnly ? codeEditorDebugReadOnly : []),
      linter((editor) => syntaxDiagnostics(editor.state, texts.current.problemEditorSyntaxError), {
        delay: 350,
        needsRefresh: (update) => localization.get(update.startState) !== localization.get(update.state),
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          sources.current = { ...sources.current, [codeLanguage]: update.state.doc.toString() };
          queueProblemDraft(problemId, { language: codeLanguage, drafts: sources.current });
        }
        const lines = update.state.field(breakpointLines);
        if (lines !== update.startState.field(breakpointLines) && !update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(setBreakpointLines)))) {
          debugBindings.current.onBreakpointsChange?.(codeLanguage, [...lines]);
        }
        const next = editorMetrics(update.state);
        setMetrics((previous) => previous.line === next.line && previous.column === next.column &&
          previous.problems === next.problems && previous.length === next.length ? previous : next);
      }),
    ] });
  }

  useLayoutEffect(() => {
    debugBindings.current = { debugEnabled, debugReadOnly, breakpoints, onBreakpointsChange };
  }, [debugEnabled, debugReadOnly, breakpoints, onBreakpointsChange]);

  useLayoutEffect(() => {
    const parent = container.current;
    if (!parent) return;
    let active = true;
    void loadProblemDraft(problemId).then((saved) => {
      if (!active) return;
      const selected = saved?.language ?? defaultLanguage;
      sources.current = saved?.drafts ?? { cpp: "", python: "" };
      drafts.current.clear();
      const editor = new EditorView({ parent, state: createDraft(selected) });
      view.current = editor;
      setMountedEditor(editor);
      setLanguage(selected);
      setMetrics(editorMetrics(editor.state));
      setLoadState("ready");
    }).catch(() => { if (active) setLoadState("failed"); });

    return () => {
      active = false;
      view.current?.destroy();
      view.current = null;
      void flushProblemDraft(problemId);
    };
  }, [problemId, loadAttempt]);

  useLayoutEffect(() => {
    texts.current = messages;
    const editor = view.current;
    if (!editor) return;
    editor.dispatch({ effects: localization.reconfigure(editorLocalization(messages, debugEnabled)) });
    forceLinting(editor);
  }, [localization, messages, debugEnabled]);

  useLayoutEffect(() => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch({ effects: editability.reconfigure(debugReadOnly ? codeEditorDebugReadOnly : []) });
  }, [debugReadOnly, editability, mountedEditor]);

  useLayoutEffect(() => {
    const editor = view.current;
    if (!editor || !breakpoints) return;
    const lines = normalizeBreakpointLines(breakpoints[language] ?? [], editor.state.doc.lines);
    if (!sameBreakpointLines(lines, editor.state.field(breakpointLines))) {
      editor.dispatch({ effects: setBreakpointLines.of(lines) });
    }
  }, [breakpoints, language, mountedEditor]);

  useLayoutEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const line = debugLine !== undefined && Number.isInteger(debugLine) && debugLine >= 1 && debugLine <= editor.state.doc.lines
      ? debugLine : undefined;
    const changed = editor.state.field(debugLineField) !== line;
    if (!changed && line === undefined) return;
    editor.dispatch({ effects: [
      ...(changed ? [setDebugLine.of(line)] : []),
      ...(line === undefined ? [] : [EditorView.scrollIntoView(editor.state.doc.line(line).from, { yMargin: 32 })]),
    ] });
  }, [debugLine, debugRevealKey, language, mountedEditor]);

  function selectLanguage(next: CodeLanguage) {
    const editor = view.current;
    if (!editor || next === language || debugReadOnly) return;
    drafts.current.set(language, { state: editor.state, scroll: editor.scrollSnapshot() });
    const saved = drafts.current.get(next);
    editor.setState(saved?.state ?? createDraft(next));
    editor.dispatch({ effects: [
      localization.reconfigure(editorLocalization(texts.current, debugEnabled)),
      ...(saved ? [saved.scroll] : []),
    ] });
    setLanguage(next);
    setMetrics(editorMetrics(editor.state));
    forceLinting(editor);
    queueProblemDraft(problemId, { language: next, drafts: sources.current });
  }

  const actionDisabled = loadState !== "ready" || running || debugReadOnly || metrics.length === 0;

  return (
    <section className="code-editor" aria-label={messages.problemCodeDraft}>
      <header className="code-editor__bar">
        <Select className="ui-select--quiet" aria-label={messages.problemEditorLanguage} title={messages.problemEditorLanguage}
          disabled={loadState !== "ready" || debugReadOnly} value={language} options={languages} onValueChange={selectLanguage} />
        {(onRun || onDebug) && (
          <div className="code-editor__actions">
            {onRun && (
              <button type="button" className="ui-icon-button code-editor__action" disabled={actionDisabled}
                aria-label={messages.problemRunLocal} title={messages.problemRunLocal} aria-busy={running || undefined}
                onClick={() => { if (view.current) onRun(language, view.current.state.doc.toString()); }}>
                <Icon name="run" />
              </button>
            )}
            {onDebug && (
              <button type="button" className="ui-icon-button code-editor__action" disabled={actionDisabled || debugUnavailable}
                aria-label={messages.problemDebugStart} title={messages.problemDebugStart}
                onClick={() => {
                  const editor = view.current;
                  if (editor) onDebug(language, editor.state.doc.toString(), [...editor.state.field(breakpointLines)]);
                }}>
                <Icon name="debug" />
              </button>
            )}
          </div>
        )}
      </header>
      <CodeEditorSurface mount={container} editor={mountedEditor}>
        {loadState !== "ready" && (
          <div className="code-editor__draft-load">
            {loadState === "loading" ? <DelayedLoadingMessage>{messages.problemDraftLoading}</DelayedLoadingMessage> : (
              <>
                <StatusMessage state="error">{messages.problemDraftLoadFailed}</StatusMessage>
                <button type="button" className="ui-field code-editor__draft-retry" onClick={() => {
                  setLoadState("loading");
                  setLoadAttempt((attempt) => attempt + 1);
                }}>{messages.retry}</button>
              </>
            )}
          </div>
        )}
      </CodeEditorSurface>
      <footer className="code-editor__status">
        {metrics.problems > 0 && (
          <button type="button" className="code-editor__problems" aria-label={problemsLabel} title={problemsLabel}
            onClick={() => { if (view.current) openLintPanel(view.current); }}>
            <span className="code-editor__problem-dot" aria-hidden="true" />{metrics.problems}
          </button>
        )}
        <span className="code-editor__position">
          {messages.problemEditorPosition.replace("{line}", String(metrics.line)).replace("{column}", String(metrics.column))}
        </span>
        {loadState === "ready" && (saveStatus === "failed" ? (
          <button type="button" className="code-editor__save-status code-editor__save-retry"
            aria-label={messages.problemDraftSaveRetry} title={messages.problemDraftSaveRetry}
            onClick={() => void flushProblemDraft(problemId)}>{messages.problemDraftSaveFailed}</button>
        ) : (
          <span className="code-editor__save-status" role="status">
            {saveStatus === "saving" ? messages.problemDraftSaving : messages.problemDraftSaved}
          </span>
        ))}
      </footer>
    </section>
  );
}
