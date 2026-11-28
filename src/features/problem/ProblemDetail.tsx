import { isTauri } from "@tauri-apps/api/core";
import { Suspense, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import { locale as interfaceLocale, t } from "../../i18n";
import type { CodeLanguage } from "../../shared/codeLanguages";
import { Icon } from "../../shared/Icon";
import { localizedLibraryText, problemContentLocale, type LibraryProblemDetail, type LocalizedProblemText, type ProblemContentLocale as ContentLocale } from "../../shared/problemLibrary";
import type { AppSettings } from "../../shared/settings";
import { DelayedLoadingMessage, StatusMessage } from "../../shared/StatusMessage";
import type { ProblemMarkdownSampleActions } from "../../shared/ui/MarkdownViewer";
import { ScrollArea } from "../../shared/ui/ScrollArea";
import { Select } from "../../shared/ui/Select";
import { isDraftWorkspaceClosing, ProblemDraftSession } from "../../shared/ui/problemDraftSession";
import { isDebugActive, ProblemDebugContext } from "./localDebug";
import { runEditorCode } from "./localRun";
import { CodeEditor, MarkdownViewer, PlainTextEditor } from "./problemComponents";
import { ProblemFavoriteAction } from "./ProblemFavoriteAction";
import { ProblemRunResults, type ProblemRunResult } from "./ProblemRunPanels";
import { ProblemSubmissions } from "./ProblemSubmissions";
import { ProblemWorkspace, type ProblemWorkspaceTab, type ProblemWorkspaceTabId } from "./ProblemWorkspace";

type LanguagePreference = ContentLocale | "interface";
type LaunchOrigin = "editor" | "sample" | "sidebar";
type ProblemLaunch = { language: CodeLanguage; stdin: string } & ({ kind: "debug" } | { kind: "run"; expected?: string });

const languageNames = { "zh-CN": "简体中文", en: "English" } as const;

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
  if (!content.value) return <StatusMessage state="empty">{empty}</StatusMessage>;

  return (
    <>
      {content.locale !== preferred && (
        <p className="problem-detail__translation" role="status">
          {t("problemTranslationFallback", { language: languageNames[content.locale] })}
        </p>
      )}
      <div lang={content.locale}>
        <Suspense fallback={<DelayedLoadingMessage>{t("problemLoading")}</DelayedLoadingMessage>}>
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
  const [solutionId, setSolutionId] = useState<string>();
  const selected = solutions.find(({ id }) => id === solutionId) ?? solutions[0];

  if (!selected) return <StatusMessage state="empty">{t("problemSolutionsEmpty")}</StatusMessage>;

  const body = readTranslation(selected.body, locale);
  return (
    <div className="problem-detail__solution">
      {solutions.length > 1 ? (
        <Select aria-label={t("problemChooseSolution")} className="ui-select--quiet problem-detail__solution-select"
          value={selected.id} onValueChange={setSolutionId}
          options={solutions.map(({ id, title, body }) => ({
            value: id, label: localizedLibraryText(title, readTranslation(body, locale).locale) || id,
          }))} />
      ) : <h2 lang={body.locale} data-selectable>{localizedLibraryText(selected.title, body.locale) || selected.id}</h2>}
      <ContentMarkdown content={body} preferred={locale} empty={t("problemSolutionEmpty")} />
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
              <span className="problem-detail__rating">{t("problemRating")} {problem.rating}</span>
            )}
            {problem.tags.length > 0 && (
              <ul className="problem-detail__tags" aria-label={t("problemTags")}>
                {problem.tags.map(({ id, name }) => <li key={id}>{localizedLibraryText(name, locale) || id}</li>)}
              </ul>
            )}
          </div>
        )}
        <ContentMarkdown content={statement} preferred={locale} empty={t("problemStatementEmpty")} sampleActions={sampleActions} />
      </div>
    </ScrollArea>
  );
}

interface ProblemDetailProps {
  problem: LibraryProblemDetail;
  title: string;
  settings: Pick<AppSettings, "problemDoubleColumn" | "editorDefaultLanguage">;
}

export function ProblemDetail(props: ProblemDetailProps) {
  const [draft, setDraft] = useState<ProblemDraftSession>();
  useLayoutEffect(() => {
    const lease = ProblemDraftSession.acquire(props.problem.id);
    setDraft(lease.draft);
    return lease.dispose;
  }, [props.problem.id]);
  return draft && <ProblemDetailContent {...props} draft={draft} />;
}

function ProblemDetailContent({ problem, title, settings, draft }: ProblemDetailProps & { draft: ProblemDraftSession }) {
  const debuggerWorkspace = useContext(ProblemDebugContext);
  const releaseDebug = debuggerWorkspace?.release;
  const registerLaunch = debuggerWorkspace?.registerLaunch;
  const isDebugTarget = debuggerWorkspace?.activeProblemId === problem.id;
  const session = debuggerWorkspace?.state;
  const debug = session?.problemId === problem.id ? session : undefined;
  const [language, setLanguage] = useState<LanguagePreference>("interface");
  const [layoutOverride, setLayoutOverride] = useState<boolean>();
  const [split, setSplit] = useState(false);
  const [input, setInput] = useState("");
  const [run, setRun] = useState<ProblemRunResult>();
  const [launchState, setLaunchState] = useState<"loading" | "empty" | "failed">();
  const [activate, setActivate] = useState<{ id: ProblemWorkspaceTabId; focus?: boolean }>();
  const launchRequest = useRef<{ origin: LaunchOrigin }>(undefined);
  const startDebugger = useRef(debuggerWorkspace?.start);
  const layoutButton = useRef<HTMLButtonElement>(null);
  const doubleColumn = layoutOverride ?? settings.problemDoubleColumn;
  const locale = language === "interface" ? problemContentLocale(interfaceLocale) : language;
  const revealKey = debug?.revealKey;
  const sourceRevealKey = debug?.sourceRevealKey;
  const debugSessionId = debug?.sessionId;
  const debugStdout = debug?.stdout ?? "";
  const debugStderr = debug?.stderr || (debug?.error === "compile_failed" ? debug.errorDetail : undefined) || "";
  const desktop = isTauri();
  const debugging = isDebugActive(debug);
  const debugActive = isDebugActive(session);
  const codeLanguage = settings.editorDefaultLanguage;
  const editorLanguage = debugging && debug ? debug.language : codeLanguage;
  const running = run?.state === "running" || run?.state === "loading-draft";
  const launchDisabled = running || launchState === "loading";
  const launchMessage = run?.state === "loading-draft" ? t("problemDraftLoading")
    : running ? t("problemRunRunning")
    : launchState === "loading" ? t("problemDraftLoading")
    : launchState === "empty" ? t("problemDebugWriteCode")
    : launchState === "failed" ? t("problemDraftLoadFailed") : undefined;

  useLayoutEffect(() => () => {
    launchRequest.current = undefined;
    releaseDebug?.(problem.id);
  }, [problem.id, releaseDebug]);

  useLayoutEffect(() => {
    startDebugger.current = debuggerWorkspace?.start;
    draft.setDebugging(debugging);
  }, [debuggerWorkspace?.start, draft, debugging]);

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

  const launch = useCallback(async (request: ProblemLaunch, origin: LaunchOrigin) => {
    if (launchRequest.current || isDraftWorkspaceClosing() ||
        (request.kind === "debug" ? debugActive || !startDebugger.current : debugging)) return;
    const attempt = { origin };
    launchRequest.current = attempt;
    setLaunchState("loading");
    if (origin === "sample") {
      setRun({ state: "loading-draft" });
      setActivate({ id: "output" });
    }
    let result: ProblemRunResult | undefined;
    try {
      const snapshot = await draft.prepareForLaunch(request.language);
      if (launchRequest.current !== attempt || isDraftWorkspaceClosing()) return;
      if (!snapshot.source.trim()) result = { state: "empty-draft" };
      else if (request.kind === "debug") startDebugger.current?.(draft.problemId, snapshot, request.stdin);
      else {
        setLaunchState(undefined);
        setRun({ state: "running" });
        if (origin !== "sample") setActivate({ id: "output" });
        result = await runEditorCode(snapshot.language, snapshot.source, request.stdin, request.expected);
      }
    } catch {
      result = { state: "failed-draft" };
    } finally {
      if (launchRequest.current === attempt) {
        launchRequest.current = undefined;
        const issue = result?.state === "empty-draft" ? "empty" : result?.state === "failed-draft" ? "failed" : undefined;
        setLaunchState(origin === "sample" ? undefined : issue);
        if (origin === "sample" || (result && !issue)) setRun(result);
        if (issue && origin !== "sample") setActivate({ id: "code", focus: false });
      }
    }
  }, [draft, debugActive, debugging]);

  useLayoutEffect(() => {
    if (isDebugTarget) return;
    if (launchRequest.current?.origin === "sidebar") launchRequest.current = undefined;
    if (!launchRequest.current) setLaunchState(undefined);
  }, [isDebugTarget]);

  useLayoutEffect(() => {
    if (!isDebugTarget || !desktop) return;
    return registerLaunch?.(problem.id, {
      start: () => void launch({ kind: "debug", language: codeLanguage, stdin: input }, "sidebar"),
      disabled: launchDisabled, message: launchMessage,
    });
  }, [isDebugTarget, desktop, registerLaunch, problem.id, launch, codeLanguage, input, launchDisabled, launchMessage]);

  const sampleActions = useMemo<ProblemMarkdownSampleActions>(() => ({
    labels: {
      run: t("problemSampleRun"),
      copy: t("problemSampleCopy"),
      fill: t("problemSampleFill"),
      copied: t("problemSampleCopied"),
      copyFailed: t("problemSampleCopyFailed"),
    },
    onRun: desktop ? ({ input, expectedOutput }) => {
      if (expectedOutput !== undefined) void launch({ kind: "run", language: codeLanguage, stdin: input, expected: expectedOutput }, "sample");
    } : undefined,
    onFill: (sampleInput) => {
      setInput(sampleInput);
      setActivate({ id: "input" });
    },
    runDisabled: launchDisabled || debugging,
  }), [interfaceLocale, desktop, launchDisabled, debugging, launch, codeLanguage]);

  const tabs: ProblemWorkspaceTab[] = [
    {
      id: "statement", label: t("problemStatement"),
      content: <ProblemStatement problem={problem} locale={locale} fallbackTitle={title} sampleActions={sampleActions} />,
    },
    {
      id: "solutions", label: t("problemSolutions"),
      content: <ScrollArea className="problem-detail__read-scroll" orientation="vertical">
        <div className="problem-detail__article"><Solutions solutions={problem.solutions} locale={locale} /></div>
      </ScrollArea>,
    },
    {
      id: "submissions", label: t("submissionHistory"), lazy: true,
      content: <ProblemSubmissions key={problem.id} problemId={problem.id} />,
    },
    {
      id: "code", label: t("problemCodeTab"), lazy: true,
      content: <div className="problem-detail__editor">
        <Suspense fallback={<DelayedLoadingMessage>{t("problemEditorLoading")}</DelayedLoadingMessage>}>
          <CodeEditor draft={draft} preferredLanguage={editorLanguage} running={running} preparing={launchState === "loading"}
            onLaunch={(kind, language) => void launch({ kind, language, stdin: input }, "editor")}
            debugReadOnly={debugging} debug={debuggerWorkspace ? debugActive ? "busy" : "ready" : undefined}
            debugLine={debug?.status === "paused" ? debug.line ?? undefined : undefined} debugRevealKey={revealKey}
          />
        </Suspense>
      </div>,
    },
    {
      id: "input", label: t("problemRunTestInput"), lazy: true,
      content: <Suspense fallback={<DelayedLoadingMessage>{t("problemEditorLoading")}</DelayedLoadingMessage>}>
        <PlainTextEditor label={t("problemRunStdin")} value={input} onChange={setInput} />
      </Suspense>,
    },
    { id: "output", label: t("problemRunResults"), content: <ProblemRunResults run={run} /> },
  ];

  return (
    <section className="workbench-page problem-detail" data-split={split}>
      <ProblemWorkspace tabs={tabs} enabled={doubleColumn} activate={activate} onSplitChange={setSplit}
        labels={{ tabs: t("problemWorkspaceArea"), resizeWidth: t("problemResizeColumns"), resizeHeight: t("resizePaneHeight") }}
        actions={(
          <div className="problem-detail__controls">
            {desktop && <ProblemFavoriteAction problemId={problem.id} />}
            <Select className="ui-select--quiet problem-detail__language" aria-label={t("problemContentLanguage")}
              title={t("problemContentLanguage")} triggerLabel={locale === "zh-CN" ? "简中" : "EN"}
              value={language} onValueChange={setLanguage} options={[
                { value: "interface", label: t("followInterface") },
                { value: "zh-CN", label: languageNames["zh-CN"] },
                { value: "en", label: languageNames.en },
              ]} />
            <button ref={layoutButton} type="button" className="ui-icon-button" aria-pressed={doubleColumn}
              aria-label={t("problemTwoColumns")} title={t("problemTwoColumns")}
              onClick={(event) => toggleLayout(event.currentTarget)}><Icon name="splitColumns" /></button>
          </div>
        )} />
    </section>
  );
}
