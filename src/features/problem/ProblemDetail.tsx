import { isTauri } from "@tauri-apps/api/core";
import { Suspense, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LocaleContext, useMessages } from "../../i18n";
import { defaultCodeLanguage, type CodeLanguage } from "../../shared/codeLanguages";
import { Icon } from "../../shared/Icon";
import { localizedLibraryText, type LibraryProblemDetail, type LocalizedProblemText } from "../../shared/problemLibrary";
import { useSettings } from "../../shared/settings";
import { DelayedLoadingMessage, StatusMessage } from "../../shared/StatusMessage";
import type { ProblemMarkdownSampleActions } from "../../shared/ui/MarkdownViewer";
import { ScrollArea } from "../../shared/ui/ScrollArea";
import { Select } from "../../shared/ui/Select";
import { loadProblemDraft } from "../../shared/ui/problemDrafts";
import { isDebugActive, ProblemDebugContext } from "./localDebug";
import { runEditorCode } from "./localRun";
import { CodeEditor, MarkdownViewer, PlainTextEditor } from "./problemComponents";
import { ProblemFavoriteAction } from "./ProblemFavoriteAction";
import { ProblemRunResults, type ProblemRunResult } from "./ProblemRunPanels";
import { ProblemSubmissions } from "./ProblemSubmissions";
import { ProblemWorkspace, type ProblemWorkspaceTab, type ProblemWorkspaceTabId } from "./ProblemWorkspace";

type ContentLocale = "zh-CN" | "en";
type LanguagePreference = ContentLocale | "interface";

const languageNames = { "zh-CN": "简体中文", en: "English" } as const;

type ProblemBreakpoints = Record<CodeLanguage, number[]>;

function breakpointKey(problemId: string) {
  return `oi-table.problem-breakpoints.${problemId}`;
}

function readBreakpoints(problemId: string): ProblemBreakpoints {
  const empty = { cpp: [], python: [] };
  try {
    const stored = localStorage.getItem(breakpointKey(problemId));
    if (!stored) return empty;
    const parsed = JSON.parse(stored) as Partial<Record<CodeLanguage, unknown>> | null;
    const read = (lines: unknown) => Array.isArray(lines)
      ? [...new Set(lines.filter((line): line is number => Number.isSafeInteger(line) && line > 0))].sort((a, b) => a - b)
      : [];
    return { cpp: read(parsed?.cpp), python: read(parsed?.python) };
  } catch {
    return empty;
  }
}

function readTranslation(text: LocalizedProblemText, preferred: ContentLocale): { value: string; locale: ContentLocale } {
  const value = preferred === "zh-CN" ? text.zhCN : text.en;
  if (value?.trim()) return { value, locale: preferred };
  const fallback = preferred === "zh-CN" ? text.en : text.zhCN;
  if (fallback?.trim()) return { value: fallback, locale: preferred === "zh-CN" ? "en" : "zh-CN" };
  return { value: "", locale: preferred };
}

function ContentMarkdown({ content, preferred, empty, sampleActions }: {
  content: ReturnType<typeof readTranslation>;
  preferred: ContentLocale;
  empty: string;
  sampleActions?: ProblemMarkdownSampleActions;
}) {
  const messages = useMessages();
  if (!content.value) return <StatusMessage state="empty">{empty}</StatusMessage>;

  return (
    <>
      {content.locale !== preferred && (
        <p className="problem-detail__translation" role="status">
          {messages.problemTranslationFallback.replace("{language}", languageNames[content.locale])}
        </p>
      )}
      <div lang={content.locale}>
        <Suspense fallback={<DelayedLoadingMessage>{messages.problemLoading}</DelayedLoadingMessage>}>
          <MarkdownViewer source={content.value} sampleActions={sampleActions} />
        </Suspense>
      </div>
    </>
  );
}

function Solutions({ solutions, locale }: {
  solutions: LibraryProblemDetail["solutions"];
  locale: ContentLocale;
}) {
  const messages = useMessages();
  const [solutionId, setSolutionId] = useState<string>();
  const selected = solutions.find(({ id }) => id === solutionId) ?? solutions[0];

  if (!selected) return <StatusMessage state="empty">{messages.problemSolutionsEmpty}</StatusMessage>;

  const body = readTranslation(selected.body, locale);
  return (
    <div className="problem-detail__solution">
      {solutions.length > 1 ? (
        <Select aria-label={messages.problemChooseSolution} className="ui-select--quiet problem-detail__solution-select"
          value={selected.id} onValueChange={setSolutionId}
          options={solutions.map(({ id, title, body }) => ({
            value: id, label: localizedLibraryText(title, readTranslation(body, locale).locale) || id,
          }))} />
      ) : <h2 lang={body.locale} data-selectable>{localizedLibraryText(selected.title, body.locale) || selected.id}</h2>}
      <ContentMarkdown content={body} preferred={locale} empty={messages.problemSolutionEmpty} />
    </div>
  );
}

function hasOpeningTitle(source: string, title: string) {
  const [first, second = ""] = source.replace(/^(?:[ \t]*\r?\n)+/, "").split(/\r?\n/, 2);
  const atx = /^ {0,3}#{1,6}[ \t]+(.+)$/.exec(first)?.[1];
  if (atx !== undefined) return atx.replace(/[ \t]+#+[ \t]*$/, "").trim() === title.trim();
  return /^ {0,3}\S/.test(first) && /^ {0,3}(?:=+|-+)[ \t]*$/.test(second) && first.trim() === title.trim();
}

function ProblemStatement({ problem, locale, fallbackTitle, sampleActions }: {
  problem: LibraryProblemDetail;
  locale: ContentLocale;
  fallbackTitle: string;
  sampleActions: ProblemMarkdownSampleActions;
}) {
  const messages = useMessages();
  const statement = readTranslation(problem.statement, locale);
  const heading = readTranslation(problem.title, statement.locale);
  const title = heading.value || fallbackTitle;

  return (
    <ScrollArea className="problem-detail__read-scroll" orientation="vertical">
      <div className="problem-detail__article">
        {!hasOpeningTitle(statement.value, title) && (
          <h1 className="problem-detail__title" lang={heading.locale} data-selectable>{title}</h1>
        )}
        {(problem.rating !== null || problem.tags.length > 0) && (
          <div className="problem-detail__metadata">
            {problem.rating !== null && (
              <span className="problem-detail__rating">{messages.problemRating} {problem.rating}</span>
            )}
            {problem.tags.length > 0 && (
              <ul className="problem-detail__tags" aria-label={messages.problemTags}>
                {problem.tags.map(({ id, name }) => <li key={id}>{localizedLibraryText(name, locale) || id}</li>)}
              </ul>
            )}
          </div>
        )}
        <ContentMarkdown content={statement} preferred={locale} empty={messages.problemStatementEmpty} sampleActions={sampleActions} />
      </div>
    </ScrollArea>
  );
}

export function ProblemDetail({ problem, title }: { problem: LibraryProblemDetail; title: string }) {
  const messages = useMessages();
  const interfaceLocale = useContext(LocaleContext);
  const { settings } = useSettings();
  const debuggerWorkspace = useContext(ProblemDebugContext);
  const releaseDebug = debuggerWorkspace?.release;
  const registerLaunch = debuggerWorkspace?.registerLaunch;
  const isDebugTarget = debuggerWorkspace?.activeProblemId === problem.id;
  const session = debuggerWorkspace?.state;
  const debug = session?.problemId === problem.id ? session : undefined;
  const [breakpoints, setBreakpoints] = useState(() => readBreakpoints(problem.id));
  const [language, setLanguage] = useState<LanguagePreference>("interface");
  const [layoutOverride, setLayoutOverride] = useState<boolean>();
  const [split, setSplit] = useState(false);
  const [input, setInput] = useState("");
  const [run, setRun] = useState<ProblemRunResult>();
  const [launchState, setLaunchState] = useState<"loading" | "empty" | "failed">();
  const [activate, setActivate] = useState<{ id: ProblemWorkspaceTabId; focus?: boolean }>();
  const busy = useRef<symbol | undefined>(undefined);
  const launchRequest = useRef<ReturnType<typeof loadProblemDraft> | undefined>(undefined);
  const launchAction = useRef<() => void>(() => {});
  const launch = useCallback(() => launchAction.current(), []);
  const layoutButton = useRef<HTMLButtonElement>(null);
  const doubleColumn = layoutOverride ?? settings?.problemDoubleColumn ?? false;
  const locale = language === "interface" ? interfaceLocale : language;
  const revealKey = debug?.revealKey;
  const sourceRevealKey = debug?.sourceRevealKey;
  const debugSessionId = debug?.sessionId;
  const debugStdout = debug?.stdout ?? "";
  const debugStderr = debug?.stderr || (debug?.error === "compile_failed" ? debug.errorDetail : undefined) || "";
  const desktop = isTauri();
  const debugging = isDebugActive(debug);
  const codeLanguage = settings?.editorDefaultLanguage ?? defaultCodeLanguage;
  const editorLanguage = debugging && debug ? debug.language : codeLanguage;
  const running = run?.state === "running" || run?.state === "loading-draft";
  const launchDisabled = running || launchState === "loading";
  const launchMessage = run?.state === "loading-draft" ? messages.problemDraftLoading
    : running ? messages.problemRunRunning
    : launchState === "loading" ? messages.problemDraftLoading
    : launchState === "empty" ? messages.problemDebugWriteCode
    : launchState === "failed" ? messages.problemDraftLoadFailed : undefined;

  useLayoutEffect(() => () => {
    busy.current = undefined;
    releaseDebug?.(problem.id);
  }, [problem.id, releaseDebug]);

  useLayoutEffect(() => {
    launchAction.current = () => { void startSavedDraft(); };
  });

  useLayoutEffect(() => {
    if (!isDebugTarget) setLaunchState(undefined);
    return () => { launchRequest.current = undefined; };
  }, [isDebugTarget]);

  useLayoutEffect(() => {
    if (isDebugTarget && desktop) {
      return registerLaunch?.(problem.id, { start: launch, disabled: launchDisabled, message: launchMessage });
    }
  }, [isDebugTarget, desktop, registerLaunch, problem.id, launch, launchDisabled, launchMessage]);

  useLayoutEffect(() => {
    if (debugSessionId !== undefined) setActivate({ id: "output", focus: false });
  }, [debugSessionId]);

  useLayoutEffect(() => {
    if (sourceRevealKey !== undefined) setActivate({ id: "code", focus: false });
  }, [sourceRevealKey]);

  useLayoutEffect(() => {
    // Keep the latest output on this problem when the debugger panel closes.
    if (debugSessionId !== undefined) setRun({ state: "debug", stdout: debugStdout, stderr: debugStderr });
  }, [debugSessionId, debugStdout, debugStderr]);

  function toggleLayout(button: HTMLButtonElement) {
    const hadFocus = button.ownerDocument.activeElement === button;
    setLayoutOverride(!doubleColumn);
    if (hadFocus) requestAnimationFrame(() => {
      if (!button.isConnected && button.ownerDocument.activeElement === button.ownerDocument.body) {
        layoutButton.current?.focus({ preventScroll: true });
      }
    });
  }

  const runDraft = useCallback(async ({ stdin, draft, expected }: {
    stdin: string;
    draft?: { language: CodeLanguage; source: string };
    expected?: string;
  }) => {
    if (busy.current || debugging) return;
    const request = Symbol();
    busy.current = request;
    launchRequest.current = undefined;
    setLaunchState(undefined);
    setRun({ state: draft ? "running" : "loading-draft" });
    setActivate({ id: "output" });
    try {
      if (!draft) {
        const saved = await loadProblemDraft(problem.id);
        if (busy.current !== request) return;
        const source = saved?.drafts[codeLanguage];
        if (!source?.trim()) {
          setRun({ state: "empty-draft" });
          return;
        }
        draft = { language: codeLanguage, source };
        setRun({ state: "running" });
      }
      const result = await runEditorCode(draft.language, draft.source, stdin, expected);
      if (busy.current === request) setRun(result);
    } catch {
      if (busy.current === request) setRun({ state: "failed-draft" });
    } finally {
      if (busy.current === request) busy.current = undefined;
    }
  }, [problem.id, debugging, codeLanguage]);

  const sampleActions = useMemo<ProblemMarkdownSampleActions>(() => ({
    labels: {
      run: messages.problemSampleRun,
      copy: messages.problemSampleCopy,
      fill: messages.problemSampleFill,
      copied: messages.problemSampleCopied,
      copyFailed: messages.problemSampleCopyFailed,
    },
    onRun: desktop ? ({ input, expectedOutput }) => {
      if (expectedOutput !== undefined) void runDraft({ stdin: input, expected: expectedOutput });
    } : undefined,
    onFill: (sampleInput) => {
      setInput(sampleInput);
      setActivate({ id: "input" });
    },
    runDisabled: running || debugging,
  }), [messages, desktop, running, debugging, runDraft]);

  function startDebug(codeLanguage: CodeLanguage, source: string, lines: number[]) {
    if (busy.current) return;
    setLaunchState(undefined);
    debuggerWorkspace?.start(problem.id, codeLanguage, source, input, lines);
  }

  async function startSavedDraft() {
    if (!debuggerWorkspace || !isDebugTarget || busy.current || launchRequest.current || isDebugActive(session)) return;
    const request = loadProblemDraft(problem.id);
    launchRequest.current = request;
    setLaunchState("loading");
    try {
      const draft = await request;
      if (launchRequest.current !== request) return;
      const source = draft?.drafts[codeLanguage];
      if (!source) {
        setLaunchState("empty");
        setActivate({ id: "code", focus: false });
        return;
      }
      const lineCount = source.split("\n").length;
      startDebug(codeLanguage, source, breakpoints[codeLanguage].filter((line) => line <= lineCount));
    } catch {
      if (launchRequest.current !== request) return;
      setLaunchState("failed");
      setActivate({ id: "code", focus: false });
    } finally {
      if (launchRequest.current === request) launchRequest.current = undefined;
    }
  }

  function updateBreakpoints(codeLanguage: CodeLanguage, lines: number[]) {
    const next = { ...breakpoints, [codeLanguage]: lines };
    setBreakpoints(next);
    debuggerWorkspace?.setBreakpoints(problem.id, codeLanguage, lines);
    try {
      if (next.cpp.length || next.python.length) localStorage.setItem(breakpointKey(problem.id), JSON.stringify(next));
      else localStorage.removeItem(breakpointKey(problem.id));
    } catch {
      // Breakpoints remain available in this workspace when storage is unavailable.
    }
  }

  const tabs: ProblemWorkspaceTab[] = [
    {
      id: "statement", label: messages.problemStatement,
      content: <ProblemStatement problem={problem} locale={locale} fallbackTitle={title} sampleActions={sampleActions} />,
    },
    {
      id: "solutions", label: messages.problemSolutions,
      content: <ScrollArea className="problem-detail__read-scroll" orientation="vertical">
        <div className="problem-detail__article"><Solutions solutions={problem.solutions} locale={locale} /></div>
      </ScrollArea>,
    },
    {
      id: "submissions", label: messages.submissionHistory, lazy: true,
      content: <ProblemSubmissions key={problem.id} problemId={problem.id} />,
    },
    {
      id: "code", label: messages.problemCodeTab, lazy: true,
      content: <div className="problem-detail__editor">
        <Suspense fallback={<DelayedLoadingMessage>{messages.problemEditorLoading}</DelayedLoadingMessage>}>
          <CodeEditor problemId={problem.id} preferredLanguage={editorLanguage} running={running}
            onRun={desktop ? (language, source) => void runDraft({ stdin: input, draft: { language, source } }) : undefined}
            breakpoints={breakpoints} onBreakpointsChange={updateBreakpoints}
            debugReadOnly={debugging} debugUnavailable={launchState === "loading" || (isDebugActive(session) && !debug)}
            debugLine={debug?.status === "paused" ? debug.line ?? undefined : undefined} debugRevealKey={revealKey}
            onDebug={desktop && debuggerWorkspace ? startDebug : undefined} />
        </Suspense>
      </div>,
    },
    {
      id: "input", label: messages.problemRunTestInput, lazy: true,
      content: <Suspense fallback={<DelayedLoadingMessage>{messages.problemEditorLoading}</DelayedLoadingMessage>}>
        <PlainTextEditor label={messages.problemRunStdin} value={input} onChange={setInput} />
      </Suspense>,
    },
    { id: "output", label: messages.problemRunResults, content: <ProblemRunResults run={run} /> },
  ];

  return (
    <section className="workbench-page problem-detail" data-split={split}>
      <ProblemWorkspace tabs={tabs} enabled={doubleColumn} activate={activate} onSplitChange={setSplit}
        labels={{ tabs: messages.problemWorkspaceArea, resizeWidth: messages.problemResizeColumns, resizeHeight: messages.resizePaneHeight }}
        actions={(
          <div className="problem-detail__controls">
            {desktop && <ProblemFavoriteAction problemId={problem.id} />}
            <Select className="ui-select--quiet problem-detail__language" aria-label={messages.problemContentLanguage}
              title={messages.problemContentLanguage} triggerLabel={locale === "zh-CN" ? "简中" : "EN"}
              value={language} onValueChange={setLanguage} options={[
                { value: "interface", label: messages.followInterface },
                { value: "zh-CN", label: languageNames["zh-CN"] },
                { value: "en", label: languageNames.en },
              ]} />
            <button ref={layoutButton} type="button" className="ui-icon-button" aria-pressed={doubleColumn}
              aria-label={messages.problemTwoColumns} title={messages.problemTwoColumns}
              onClick={(event) => toggleLayout(event.currentTarget)}><Icon name="splitColumns" /></button>
          </div>
        )} />
    </section>
  );
}
