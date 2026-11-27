import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput, indentUnit } from "@codemirror/language";
import {
  diagnosticCount, forceLinting, linter, lintKeymap, openLintPanel,
} from "@codemirror/lint";
import { Compartment, EditorState, type Text } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { locale, t } from "../../i18n";
import { codeLanguageOptions, type CodeLanguage } from "../codeLanguages";
import { Icon } from "../Icon";
import { updateSettings } from "../settings";
import { DelayedLoadingMessage, StatusMessage } from "../StatusMessage";
import { codeLanguageExtensions, syntaxDiagnostics } from "./codeLanguages";
import { codeSyntaxHighlighting } from "./codeEditorTheme";
import { breakpointLines, codeEditorBreakpointGutter, codeEditorDebugReadOnly, debugLine as debugLineField,
  normalizeBreakpointLines, sameBreakpointLines, setBreakpointLines, setDebugLine } from "./codeEditorDebug";
import { CodeEditorSurface, codeEditorContent, codeEditorDefaultKeymap, codeEditorSurfaceExtensions } from "./CodeEditorSurface";
import {
  flushProblemDraft, loadProblemDraft, problemDraftSaveStatus, queueProblemDraft, subscribeToProblemDraft, type DraftOperation,
} from "./problemDrafts";
import { Select } from "./Select";

const editorExtensions = [
  codeEditorSurfaceExtensions, indentOnInput(), indentUnit.of("    "),
  bracketMatching(), closeBrackets(), autocompletion(), codeSyntaxHighlighting,
  keymap.of([...closeBracketsKeymap, ...completionKeymap, ...historyKeymap, ...codeEditorDefaultKeymap, ...lintKeymap, indentWithTab]),
];

type SavedDraft = { state: EditorState; scroll: ReturnType<EditorView["scrollSnapshot"]> };

function editorLocalization(debugEnabled: boolean) {
  return [
    codeEditorContent(t("problemCodeDraft")),
    debugEnabled ? codeEditorBreakpointGutter(`${t("problemDebugToggleBreakpoint")} (F9)`) : [],
    EditorState.phrases.of({
      Diagnostics: t("problemEditorDiagnosticList"),
      "No diagnostics": t("problemEditorNoDiagnostics"),
      "close": t("close"),
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
  preferredLanguage: CodeLanguage;
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

export default function CodeEditor({ problemId, preferredLanguage, onRun, running = false, onDebug, breakpoints, onBreakpointsChange,
  debugLine, debugRevealKey, debugReadOnly = false, debugUnavailable = false }: CodeEditorProps) {
  const desktop = isTauri();
  const preferredLanguageRef = useRef(preferredLanguage);
  const activeLanguage = useRef(preferredLanguage);
  const latestDefaultLanguageUpdate = useRef<Promise<void>>(undefined);
  const debugEnabled = onDebug !== undefined;
  const debugBindings = useRef({ debugEnabled, debugReadOnly, breakpoints, onBreakpointsChange });
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const drafts = useRef(new Map<CodeLanguage, SavedDraft>());
  const sources = useRef<Record<CodeLanguage, string | Text>>({ cpp: "", python: "" });
  const [localization] = useState(() => new Compartment());
  const [editability] = useState(() => new Compartment());
  const [language, setLanguage] = useState(preferredLanguage);
  const [defaultLanguageSaveFailed, setDefaultLanguageSaveFailed] = useState(false);
  const [metrics, setMetrics] = useState({ line: 1, column: 1, problems: 0, length: 0 });
  const [mountedEditor, setMountedEditor] = useState<EditorView>();
  const [loadState, setLoadState] = useState<"loading" | "ready" | "failed">("loading");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const subscribe = useCallback((listener: () => void) => subscribeToProblemDraft(problemId, listener), [problemId]);
  const saveStatus = useSyncExternalStore(subscribe, () => problemDraftSaveStatus(problemId));
  const problemsLabel = t("problemEditorProblems", { count: metrics.problems });

  function queueDraftChange(change: DraftOperation) {
    const contents = sources.current;
    queueProblemDraft(problemId, change, () => ({
      language: change.language,
      drafts: { cpp: contents.cpp.toString(), python: contents.python.toString() },
    }));
  }

  function createDraft(codeLanguage: CodeLanguage) {
    return EditorState.create({ doc: sources.current[codeLanguage], extensions: [
      editorExtensions,
      codeLanguageExtensions(codeLanguage),
      breakpointLines.init((state) => normalizeBreakpointLines(debugBindings.current.breakpoints?.[codeLanguage] ?? [], state.doc.lines)),
      debugLineField,
      localization.of(editorLocalization(debugBindings.current.debugEnabled)),
      editability.of(debugBindings.current.debugReadOnly ? codeEditorDebugReadOnly : []),
      linter((editor) => syntaxDiagnostics(editor.state, t("problemEditorSyntaxError")), {
        delay: 350,
        needsRefresh: (update) => localization.get(update.startState) !== localization.get(update.state),
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          sources.current = { ...sources.current, [codeLanguage]: update.state.doc };
          queueDraftChange({ kind: "edit", language: codeLanguage, changes: update.changes });
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
    preferredLanguageRef.current = preferredLanguage;
    changeEditorLanguage(preferredLanguage);
  }, [preferredLanguage]);

  useLayoutEffect(() => {
    const parent = container.current;
    if (!parent) return;
    let active = true;
    void loadProblemDraft(problemId).then((saved) => {
      if (!active) return;
      const selected = preferredLanguageRef.current;
      sources.current = saved?.drafts ?? { cpp: "", python: "" };
      drafts.current.clear();
      const editor = new EditorView({ parent, state: createDraft(selected) });
      view.current = editor;
      activeLanguage.current = selected;
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
    const editor = view.current;
    if (!editor) return;
    editor.dispatch({ effects: localization.reconfigure(editorLocalization(debugEnabled)) });
    forceLinting(editor);
  }, [localization, locale, debugEnabled]);

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

  function changeEditorLanguage(next: CodeLanguage) {
    const editor = view.current;
    const previous = activeLanguage.current;
    if (!editor || next === previous) return;
    drafts.current.set(previous, { state: editor.state, scroll: editor.scrollSnapshot() });
    const saved = drafts.current.get(next);
    editor.setState(saved?.state ?? createDraft(next));
    editor.dispatch({ effects: [
      localization.reconfigure(editorLocalization(debugEnabled)),
      editability.reconfigure(debugReadOnly ? codeEditorDebugReadOnly : []),
      ...(saved ? [saved.scroll] : []),
    ] });
    activeLanguage.current = next;
    setLanguage(next);
    setMetrics(editorMetrics(editor.state));
    forceLinting(editor);
  }

  function selectLanguage(next: CodeLanguage) {
    if (!view.current || debugReadOnly) return;
    queueDraftChange({ kind: "language", language: next });
    if (!desktop) {
      changeEditorLanguage(next);
      return;
    }

    setDefaultLanguageSaveFailed(false);
    const update = updateSettings({ editorDefaultLanguage: next });
    latestDefaultLanguageUpdate.current = update;
    void update.catch(() => {
      if (latestDefaultLanguageUpdate.current === update) setDefaultLanguageSaveFailed(true);
    });
  }

  const actionDisabled = loadState !== "ready" || running || debugReadOnly || metrics.length === 0;

  return (
    <section className="code-editor" aria-label={t("problemCodeDraft")}>
      <header className="code-editor__bar">
        <Select className="ui-select--quiet" aria-label={t("problemEditorLanguage")}
          title={desktop ? t("problemEditorLanguageHint") : t("problemEditorLanguage")}
          disabled={loadState !== "ready" || debugReadOnly} value={language} options={codeLanguageOptions}
          notifyOnReselect={desktop} onValueChange={selectLanguage} />
        {(onRun || onDebug) && (
          <div className="code-editor__actions">
            {onRun && (
              <button type="button" className="ui-icon-button code-editor__action" disabled={actionDisabled}
                aria-label={t("problemRunLocal")} title={t("problemRunLocal")} aria-busy={running || undefined}
                onClick={() => { if (view.current) onRun(language, view.current.state.doc.toString()); }}>
                <Icon name="run" />
              </button>
            )}
            {onDebug && (
              <button type="button" className="ui-icon-button code-editor__action" disabled={actionDisabled || debugUnavailable}
                aria-label={t("problemDebugStart")} title={t("problemDebugStart")}
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
            {loadState === "loading" ? <DelayedLoadingMessage>{t("problemDraftLoading")}</DelayedLoadingMessage> : (
              <>
                <StatusMessage state="error">{t("problemDraftLoadFailed")}</StatusMessage>
                <button type="button" className="ui-field code-editor__draft-retry" onClick={() => {
                  setLoadState("loading");
                  setLoadAttempt((attempt) => attempt + 1);
                }}>{t("retry")}</button>
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
        {defaultLanguageSaveFailed && (
          <span className="code-editor__settings-error" role="alert">{t("settingsSaveFailed")}</span>
        )}
        <span className="code-editor__position">
          {t("problemEditorPosition", { line: metrics.line, column: metrics.column })}
        </span>
        {loadState === "ready" && (saveStatus === "failed" ? (
          <button type="button" className="code-editor__save-status code-editor__save-retry"
            aria-label={t("problemDraftSaveRetry")} title={t("problemDraftSaveRetry")}
            onClick={() => void flushProblemDraft(problemId)}>{t("problemDraftSaveFailed")}</button>
        ) : (
          <span className="code-editor__save-status" role="status">
            {saveStatus === "saving" ? t("problemDraftSaving") : t("problemDraftSaved")}
          </span>
        ))}
      </footer>
    </section>
  );
}
