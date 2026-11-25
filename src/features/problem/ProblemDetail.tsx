import { isTauri } from "@tauri-apps/api/core";
import { lazy, Suspense, useContext, useRef, useState } from "react";
import { LocaleContext, useMessages } from "../../i18n";
import { Icon } from "../../shared/Icon";
import { localizedLibraryText, type LibraryProblemDetail, type LocalizedProblemText } from "../../shared/problemLibrary";
import { useSettings } from "../../shared/settings";
import { StatusMessage } from "../../shared/StatusMessage";
import { ScrollArea } from "../../shared/ui/ScrollArea";
import { Select } from "../../shared/ui/Select";
import type { CodeLanguage } from "../../shared/ui/codeLanguages";
import { runEditorCode, type LocalRun } from "./localRun";
import { ProblemRunResults } from "./ProblemRunPanels";
import { ProblemSubmissions } from "./ProblemSubmissions";
import { ProblemWorkspace, type ProblemWorkspaceTab, type ProblemWorkspaceTabId } from "./ProblemWorkspace";

const MarkdownViewer = lazy(() => import("../../shared/ui/MarkdownViewer"));
const CodeEditor = lazy(() => import("../../shared/ui/CodeEditor"));
const PlainTextEditor = lazy(() => import("../../shared/ui/PlainTextEditor"));

type ContentLocale = "zh-CN" | "en";
type LanguagePreference = ContentLocale | "interface";

const languageNames = { "zh-CN": "简体中文", en: "English" } as const;

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
  const [language, setLanguage] = useState<LanguagePreference>("interface");
  const [layoutOverride, setLayoutOverride] = useState<boolean>();
  const [split, setSplit] = useState(false);
  const [input, setInput] = useState("");
  const [run, setRun] = useState<LocalRun>();
  const [activate, setActivate] = useState<{ id: ProblemWorkspaceTabId }>();
  const busy = useRef(false);
  const layoutButton = useRef<HTMLButtonElement>(null);
  const doubleColumn = layoutOverride ?? settings?.problemDoubleColumn ?? false;
  const locale = language === "interface" ? interfaceLocale : language;

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
    busy.current = true;
    setRun({ state: "running", language: codeLanguage });
    setActivate({ id: "output" });
    try {
      setRun(await runEditorCode(codeLanguage, source, input));
    } finally {
      busy.current = false;
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
          <CodeEditor problemId={problem.id} onRun={isTauri() ? runDraft : undefined} running={run?.state === "running"} />
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
