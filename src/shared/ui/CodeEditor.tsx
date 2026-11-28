import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput, indentUnit } from "@codemirror/language";
import {
  diagnosticCount, forceLinting, linter, lintKeymap, openLintPanel,
} from "@codemirror/lint";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { isTauri } from "@tauri-apps/api/core";
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { locale, t } from "../../i18n";
import { codeLanguageOptions, type CodeLanguage } from "../codeLanguages";
import { Icon } from "../Icon";
import { updateSettings } from "../settings";
import { DelayedLoadingMessage, StatusMessage } from "../StatusMessage";
import { codeLanguageExtensions, syntaxDiagnostics } from "./codeLanguages";
import { codeSyntaxHighlighting } from "./codeEditorTheme";
import { breakpointLines, codeEditorBreakpointGutter, codeEditorDebugReadOnly, debugLine as debugLineField,
  setBreakpointLines, setDebugLine } from "./codeEditorDebug";
import { CodeEditorSurface, codeEditorContent, codeEditorDefaultKeymap, codeEditorSurfaceExtensions } from "./CodeEditorSurface";
import type { ProblemDraftSession } from "./problemDraftSession";
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
  draft: ProblemDraftSession;
  preferredLanguage: CodeLanguage;
  onLaunch: (kind: "run" | "debug", language: CodeLanguage) => void;
  running?: boolean;
  preparing?: boolean;
  debug?: "ready" | "busy";
  debugLine?: number;
  debugRevealKey?: number;
  debugReadOnly?: boolean;
}

export default function CodeEditor({ draft, preferredLanguage, onLaunch, running = false, preparing = false, debug,
  debugLine, debugRevealKey, debugReadOnly = false }: CodeEditorProps) {
  const desktop = isTauri();
  const preferredLanguageRef = useRef(preferredLanguage);
  const activeLanguage = useRef(preferredLanguage);
  const latestDefaultLanguageUpdate = useRef<Promise<void>>(undefined);
  const debugEnabled = desktop && debug !== undefined;
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const drafts = useRef(new Map<CodeLanguage, SavedDraft>());
  const [localization] = useState(() => new Compartment());
  const [editability] = useState(() => new Compartment());
  const [language, setLanguage] = useState(preferredLanguage);
  const [defaultLanguageSaveFailed, setDefaultLanguageSaveFailed] = useState(false);
  const [metrics, setMetrics] = useState({ line: 1, column: 1, problems: 0, length: 0 });
  const [editorState, setEditorState] = useState<EditorView | "failed">();
  const mountedEditor = editorState === "failed" ? undefined : editorState;
  const [loadAttempt, setLoadAttempt] = useState(0);
  const external = useSyncExternalStore(draft.subscribe, draft.getExternalStatus);
  const externalStatus = external?.phase;
  const externalBusy = externalStatus === "opening" || externalStatus === "closing";
  const externalActive = externalBusy || externalStatus === "active" || externalStatus === "syncFailed";
  const externalLanguage = externalActive ? external?.language : undefined;
  const saveStatus = useSyncExternalStore(draft.subscribe, draft.getSaveStatus);
  const problemsLabel = t("problemEditorProblems", { count: metrics.problems });

  function createDraft(codeLanguage: CodeLanguage) {
    const document = draft.document(codeLanguage);
    return EditorState.create({ doc: document.doc, extensions: [
      editorExtensions,
      codeLanguageExtensions(codeLanguage),
      breakpointLines.init(() => document.breakpoints),
      debugLineField,
      localization.of([]), editability.of([]),
      linter((editor) => syntaxDiagnostics(editor.state, t("problemEditorSyntaxError")), {
        delay: 350,
        needsRefresh: (update) => localization.get(update.startState) !== localization.get(update.state),
      }),
      EditorView.updateListener.of((update) => {
        const lines = update.state.field(breakpointLines);
        if ((update.docChanged || lines !== update.startState.field(breakpointLines)) &&
            !update.transactions.some((transaction) => transaction.isUserEvent("input.external"))) {
          draft.recordEditorUpdate(codeLanguage, update.state.doc, update.changes, lines);
        }
        const next = editorMetrics(update.state);
        setMetrics((previous) => previous.line === next.line && previous.column === next.column &&
          previous.problems === next.problems && previous.length === next.length ? previous : next);
      }),
    ] });
  }

  useLayoutEffect(() => {
    preferredLanguageRef.current = preferredLanguage;
    changeEditorLanguage(preferredLanguage);
  }, [preferredLanguage]);

  useLayoutEffect(() => {
    const parent = container.current;
    if (!parent) return;
    let active = true;
    const unsubscribe = draft.subscribe((change) => {
      if (!change) return;
      const { language, changes, document } = change;
      const transaction = { changes, effects: setBreakpointLines.of(document.breakpoints), userEvent: "input.external" };
      const editor = view.current;
      if (editor && activeLanguage.current === language) {
        editor.dispatch(transaction);
      } else {
        const saved = drafts.current.get(language);
        if (saved) drafts.current.set(language, {
          state: saved.state.update(transaction).state,
          scroll: saved.scroll.map(changes) ?? saved.scroll,
        });
      }
    });
    void draft.load().then(() => {
      if (!active) return;
      const selected = preferredLanguageRef.current;
      drafts.current.clear();
      const editor = new EditorView({ parent, state: createDraft(selected) });
      view.current = editor;
      activeLanguage.current = selected;
      setEditorState(editor);
      setLanguage(selected);
      setMetrics(editorMetrics(editor.state));
    }).catch(() => { if (active) setEditorState("failed"); });

    return () => {
      active = false;
      unsubscribe();
      view.current?.destroy();
      view.current = null;
    };
  }, [draft, loadAttempt]);

  useLayoutEffect(() => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch({ effects: [
      localization.reconfigure(editorLocalization(debugEnabled)),
      editability.reconfigure(debugReadOnly || externalLanguage === activeLanguage.current ? codeEditorDebugReadOnly : []),
    ] });
    forceLinting(editor);
  }, [localization, editability, locale, debugEnabled, debugReadOnly, externalLanguage, language, mountedEditor]);

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
    if (saved) editor.dispatch({ effects: saved.scroll });
    activeLanguage.current = next;
    setLanguage(next);
    setMetrics(editorMetrics(editor.state));
  }

  function selectLanguage(next: CodeLanguage) {
    if (!view.current || debugReadOnly) return;
    draft.selectLanguage(next);
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

  const actionDisabled = !mountedEditor || preparing || running || debugReadOnly ||
    (metrics.length === 0 && externalLanguage !== language);
  const externalAction = t(externalActive ? "problemExternalEditorStop" : "problemExternalEditorOpen");
  const externalMessage = externalStatus === "active" ? t("problemExternalEditorActive", {
    language: codeLanguageOptions.find(({ value }) => value === externalLanguage)?.label ?? "",
  })
    : externalStatus === "missing" ? t("problemExternalEditorMissing")
    : externalStatus === "tooLarge" ? t("problemExternalEditorTooLarge")
    : externalStatus === "openFailed" ? t("problemExternalEditorOpenFailed")
    : externalStatus === "syncFailed" || externalStatus === "closeFailed" ? t("problemExternalEditorSyncFailed") : undefined;

  return (
    <section className="code-editor" aria-label={t("problemCodeDraft")}>
      <header className="code-editor__bar">
        <Select className="ui-select--quiet" aria-label={t("problemEditorLanguage")}
          title={desktop ? t("problemEditorLanguageHint") : t("problemEditorLanguage")}
          disabled={!mountedEditor || debugReadOnly} value={language} options={codeLanguageOptions}
          notifyOnReselect={desktop} onValueChange={selectLanguage} />
        {desktop && (
          <div className="code-editor__actions">
            <button type="button" className="ui-icon-button code-editor__action" aria-pressed={externalActive}
              disabled={!mountedEditor || debugReadOnly || externalBusy} aria-busy={externalBusy || undefined}
              aria-label={externalAction} title={externalAction} onClick={() => void draft.toggleExternal(activeLanguage.current)}>
              <Icon name={externalActive ? "stop" : "externalEditor"} />
            </button>
            <button type="button" className="ui-icon-button code-editor__action" disabled={actionDisabled}
              aria-label={t("problemRunLocal")} title={t("problemRunLocal")} aria-busy={running || undefined}
              onClick={() => onLaunch("run", activeLanguage.current)}>
              <Icon name="run" />
            </button>
            {debugEnabled && (
              <button type="button" className="ui-icon-button code-editor__action" disabled={actionDisabled || debug === "busy"}
                aria-label={t("problemDebugStart")} title={t("problemDebugStart")}
                onClick={() => onLaunch("debug", activeLanguage.current)}>
                <Icon name="debug" />
              </button>
            )}
          </div>
        )}
      </header>
      <CodeEditorSurface mount={container} editor={mountedEditor}>
        {!mountedEditor && (
          <div className="code-editor__draft-load">
            {editorState !== "failed" ? <DelayedLoadingMessage>{t("problemDraftLoading")}</DelayedLoadingMessage> : (
              <>
                <StatusMessage state="error">{t("problemDraftLoadFailed")}</StatusMessage>
                <button type="button" className="ui-field code-editor__draft-retry" onClick={() => {
                  setEditorState(undefined);
                  setLoadAttempt((attempt) => attempt + 1);
                }}>{t("retry")}</button>
              </>
            )}
          </div>
        )}
      </CodeEditorSurface>
      <footer className="code-editor__status">
        {externalMessage && <span className={externalStatus === "active" ? "code-editor__position" : "code-editor__position code-editor__settings-error"}
          title={externalMessage}
          role={externalStatus === "active" ? "status" : "alert"}>{externalMessage}</span>}
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
        {mountedEditor && (saveStatus === "failed" ? (
          <button type="button" className="code-editor__save-status code-editor__save-retry"
            aria-label={t("problemDraftSaveRetry")} title={t("problemDraftSaveRetry")}
            onClick={() => void draft.flush()}>{t("problemDraftSaveFailed")}</button>
        ) : (
          <span className="code-editor__save-status" role="status">
            {saveStatus === "saving" ? t("problemDraftSaving") : t("problemDraftSaved")}
          </span>
        ))}
      </footer>
    </section>
  );
}
