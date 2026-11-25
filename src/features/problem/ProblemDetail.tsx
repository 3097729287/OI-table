import { isTauri } from "@tauri-apps/api/core";
import { lazy, Suspense, useCallback, useContext, useLayoutEffect, useRef, useState } from "react";
import { LocaleContext, useMessages } from "../../i18n";
import { Icon } from "../../shared/Icon";
import { localizedLibraryText, type LibraryProblemDetail, type LocalizedProblemText } from "../../shared/problemLibrary";
import { useSettings } from "../../shared/settings";
import { StatusMessage } from "../../shared/StatusMessage";
import { ScrollArea } from "../../shared/ui/ScrollArea";
import { Select } from "../../shared/ui/Select";
import type { CodeLanguage } from "../../shared/ui/codeLanguages";
import { loadProblemDraft } from "../../shared/ui/problemDrafts";
import { isDebugActive, ProblemDebugContext } from "./localDebug";
import { runEditorCode } from "./localRun";
import { ProblemRunResults, type ProblemRunResult } from "./ProblemRunPanels";
import { ProblemSubmissions } from "./ProblemSubmissions";
import { ProblemWorkspace, type ProblemWorkspaceTab, type ProblemWorkspaceTabId } from "./ProblemWorkspace";

const MarkdownViewer = lazy(() => import("../../shared/ui/MarkdownViewer"));
const CodeEditor = lazy(() => import("../../shared/ui/CodeEditor"));
const PlainTextEditor = lazy(() => import("../../shared/ui/PlainTextEditor"));

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

function ContentMarkdown({ content, preferred, empty }: {
  content: ReturnType<typeof readTranslation>;
  preferred: ContentLocale;
  empty: string;
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
        <Suspense fallback={<StatusMessage state="loading">{messages.problemLoading}</StatusMessage>}>
          <MarkdownViewer source={content.value} />
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

function ProblemStatement({ problem, locale, fallbackTitle }: {
  problem: LibraryProblemDetail;
  locale: ContentLocale;
  fallbackTitle: string;
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
        <ContentMarkdown content={statement} preferred={locale} empty={messages.problemStatementEmpty} />
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
  const busy = useRef(false);
  const launchRequest = useRef<ReturnType<typeof loadProblemDraft> | undefined>(undefined);
  const launchAction = useRef<() => void>(() => {});
  const launch = useCallback(() => launchAction.current(), []);
  const layoutButton = useRef<HTMLButtonElement>(null);
  const doubleColumn = layoutOverride ?? settings?.problemDoubleColumn ?? false;
  const locale = language === "interface" ? interfaceLocale : language;
  const revealKey = debug?.revealKey;
  const debugSessionId = debug?.sessionId;
  const debugStdout = debug?.stdout ?? "";
  const debugStderr = debug?.stderr || (debug?.error === "compile_failed" ? debug.errorDetail : undefined) || "";
  const running = run?.state === "running";
  const launchDisabled = running || launchState === "loading";
  const launchMessage = running ? messages.problemRunRunning
    : launchState === "loading" ? messages.problemDraftLoading
    : launchState === "empty" ? messages.problemDebugWriteCode
    : launchState === "failed" ? messages.problemDraftLoadFailed : undefined;

  useLayoutEffect(() => () => releaseDebug?.(problem.id), [problem.id, releaseDebug]);

  useLayoutEffect(() => {
    launchAction.current = () => { void startSavedDraft(); };
  });

  useLayoutEffect(() => {
    if (!isDebugTarget) setLaunchState(undefined);
    return () => { launchRequest.current = undefined; };
  }, [isDebugTarget]);

  useLayoutEffect(() => {
    if (isDebugTarget && isTauri()) {
      return registerLaunch?.(problem.id, { start: launch, disabled: launchDisabled, message: launchMessage });
    }
  }, [isDebugTarget, registerLaunch, problem.id, launch, launchDisabled, launchMessage]);

  useLayoutEffect(() => {
    if (revealKey) setActivate({ id: "code", focus: false });
  }, [revealKey]);

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

  async function runDraft(codeLanguage: CodeLanguage, source: string) {
    if (busy.current) return;
    launchRequest.current = undefined;
    setLaunchState(undefined);
    busy.current = true;
    setRun({ state: "running", language: codeLanguage });
    setActivate({ id: "output" });
    try {
      setRun(await runEditorCode(codeLanguage, source, input));
    } finally {
      busy.current = false;
    }
  }

  function startDebug(codeLanguage: CodeLanguage, source: string, lines: number[]) {
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
      setActivate({ id: "code", focus: false });
      if (!draft || !draft.drafts[draft.language]) {
        setLaunchState("empty");
        return;
      }
      const source = draft.drafts[draft.language];
      const lineCount = source.split("\n").length;
      startDebug(draft.language, source,
        breakpoints[draft.language].filter((line) => line <= lineCount));
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
      content: <ProblemStatement problem={problem} locale={locale} fallbackTitle={title} />,
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
        <Suspense fallback={<StatusMessage state="loading">{messages.problemEditorLoading}</StatusMessage>}>
          <CodeEditor problemId={problem.id} onRun={isTauri() ? runDraft : undefined} running={running}
            breakpoints={breakpoints} onBreakpointsChange={updateBreakpoints}
            debugReadOnly={isDebugActive(debug)} debugUnavailable={launchState === "loading" || (isDebugActive(session) && !debug)}
            debugLine={debug?.status === "paused" ? debug.line ?? undefined : undefined} debugRevealKey={revealKey}
            onDebug={isTauri() && debuggerWorkspace ? startDebug : undefined} />
        </Suspense>
      </div>,
    },
    {
      id: "input", label: messages.problemRunTestInput, lazy: true,
      content: <Suspense fallback={<StatusMessage state="loading">{messages.problemEditorLoading}</StatusMessage>}>
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
