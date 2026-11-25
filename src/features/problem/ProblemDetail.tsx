import { lazy, Suspense, useContext, useId, useRef, useState, type KeyboardEvent } from "react";
import { LocaleContext, useMessages } from "../../i18n";
import { localizedLibraryText, type LibraryProblemDetail, type LocalizedProblemText } from "../../shared/problemLibrary";
import { useSettings } from "../../shared/settings";
import { StatusMessage } from "../../shared/StatusMessage";
import { ScrollArea } from "../../shared/ui/ScrollArea";
import { Scrollbar } from "../../shared/ui/Scrollbar";
import { Select } from "../../shared/ui/Select";
import { ProblemSplit } from "./ProblemSplit";

const MarkdownViewer = lazy(() => import("../../shared/ui/MarkdownViewer"));

type ContentLocale = "zh-CN" | "en";
type ReadingTab = "statement" | "solutions";
type Surface = "reader" | "editor";
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
      {solutions.length > 1 && (
        <Select aria-label={messages.problemChooseSolution} className="problem-detail__solution-select"
          value={selected.id} onValueChange={setSolutionId}
          options={solutions.map(({ id, title, body }) => ({
            value: id, label: localizedLibraryText(title, readTranslation(body, locale).locale) || id,
          }))} />
      )}
      <h2 lang={body.locale} data-selectable>{localizedLibraryText(selected.title, body.locale) || selected.id}</h2>
      <ContentMarkdown content={body} preferred={locale} empty={messages.problemSolutionEmpty} />
    </div>
  );
}

function ProblemReader({ problem, language, onLanguageChange, onFocus }: {
  problem: LibraryProblemDetail;
  language: LanguagePreference;
  onLanguageChange(language: LanguagePreference): void;
  onFocus(): void;
}) {
  const messages = useMessages();
  const interfaceLocale = useContext(LocaleContext);
  const [tab, setTab] = useState<ReadingTab>("statement");
  const id = useId();
  const locale = language === "interface" ? interfaceLocale : language;
  const statement = readTranslation(problem.statement, locale);

  function moveTab(event: KeyboardEvent<HTMLButtonElement>) {
    let next: ReadingTab;
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowRight": next = tab === "statement" ? "solutions" : "statement"; break;
      case "Home": next = "statement"; break;
      case "End": next = "solutions"; break;
      default: return;
    }
    event.preventDefault();
    setTab(next);
    document.getElementById(`${id}-tab-${next}`)?.focus();
  }

  return (
    <div className="problem-detail__reader" onFocusCapture={onFocus}>
      <div className="problem-detail__reader-bar">
        <div className="problem-detail__reader-controls">
          <div className="problem-detail__reader-tabs" role="tablist" aria-label={messages.problemContent}>
            {(["statement", "solutions"] as const).map((current) => (
              <button key={current} id={`${id}-tab-${current}`} type="button" role="tab"
                className="problem-detail__reader-tab" aria-selected={tab === current}
                aria-controls={`${id}-panel-${current}`} tabIndex={tab === current ? 0 : -1}
                onClick={() => setTab(current)} onKeyDown={moveTab}>
                {current === "statement" ? messages.problemStatement : messages.problemSolutions}
              </button>
            ))}
          </div>
          <Select className="problem-detail__language" aria-label={messages.problemContentLanguage}
            value={language} onValueChange={onLanguageChange} options={[
              { value: "interface", label: messages.followInterface },
              { value: "zh-CN", label: languageNames["zh-CN"] },
              { value: "en", label: languageNames.en },
            ]} />
        </div>
      </div>
      <ScrollArea className="problem-detail__read-scroll" orientation="vertical" hidden={tab !== "statement"}
        id={`${id}-panel-statement`} role="tabpanel" aria-labelledby={`${id}-tab-statement`} tabIndex={0}>
        <div className="problem-detail__article">
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
      <ScrollArea className="problem-detail__read-scroll" orientation="vertical" hidden={tab !== "solutions"}
        id={`${id}-panel-solutions`} role="tabpanel" aria-labelledby={`${id}-tab-solutions`} tabIndex={0}>
        <div className="problem-detail__article">
          <Solutions solutions={problem.solutions} locale={locale} />
        </div>
      </ScrollArea>
    </div>
  );
}

function CodeDraft({ onFocus }: { onFocus(): void }) {
  const messages = useMessages();
  const [value, setValue] = useState("");
  const [position, setPosition] = useState({ line: 1, column: 1 });
  const editor = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  function updatePosition(field: HTMLTextAreaElement) {
    const caret = field.selectionDirection === "backward" ? field.selectionStart : field.selectionEnd;
    const lines = field.value.slice(0, caret).split("\n");
    const line = lines.length;
    const column = lines[line - 1].length + 1;
    setPosition((current) => current.line === line && current.column === column ? current : { line, column });
  }

  return (
    <section className="problem-detail__editor" aria-labelledby={`${id}-heading`} onFocusCapture={onFocus}>
      <header className="problem-detail__editor-bar">
        <h2 id={`${id}-heading`}>{messages.problemCodeDraft}</h2>
      </header>
      <div className="problem-detail__draft scrollbar-host">
        <textarea ref={editor} id={id} value={value} onChange={(event) => {
          setValue(event.currentTarget.value);
          updatePosition(event.currentTarget);
        }} onSelect={(event) => updatePosition(event.currentTarget)}
          aria-labelledby={`${id}-heading`} placeholder={messages.problemCodeDraftPlaceholder}
          spellCheck={false} autoCapitalize="off" autoComplete="off" wrap="off" data-selectable />
        <Scrollbar viewport={editor} controls={id} orientation="vertical" label={messages.scrollVertically} />
        <Scrollbar viewport={editor} controls={id} orientation="horizontal" label={messages.scrollHorizontally} />
      </div>
      <footer className="problem-detail__editor-status">
        {messages.problemEditorPosition.replace("{line}", String(position.line)).replace("{column}", String(position.column))}
      </footer>
    </section>
  );
}

export function ProblemDetail({ problem, title }: { problem: LibraryProblemDetail; title: string }) {
  const messages = useMessages();
  const interfaceLocale = useContext(LocaleContext);
  const { settings } = useSettings();
  const [language, setLanguage] = useState<LanguagePreference>("interface");
  const [surface, setSurface] = useState<Surface>("reader");
  const [layoutOverride, setLayoutOverride] = useState<boolean>();
  const [split, setSplit] = useState(false);
  const doubleColumn = layoutOverride ?? settings?.problemDoubleColumn ?? false;
  const locale = language === "interface" ? interfaceLocale : language;
  const statement = readTranslation(problem.statement, locale);
  const heading = readTranslation(problem.title, statement.locale);
  return (
    <section className="workbench-page problem-detail" data-split={split}>
      <header className="problem-detail__header">
        <h1 lang={heading.locale} data-selectable>{heading.value || title}</h1>
        <div className="problem-detail__controls">
          {!split && (
            <div className="problem-detail__surface-switch" role="group" aria-label={messages.problemWorkspaceArea}>
              <button className="problem-detail__surface-button" type="button" aria-pressed={surface === "reader"}
                onClick={() => setSurface("reader")}>{messages.problemReadSurface}</button>
              <button className="problem-detail__surface-button" type="button" aria-pressed={surface === "editor"}
                onClick={() => setSurface("editor")}>{messages.editor}</button>
            </div>
          )}
          <button type="button" className="ui-field problem-detail__layout" aria-pressed={doubleColumn}
            onClick={() => setLayoutOverride(!doubleColumn)}>{messages.problemTwoColumns}</button>
        </div>
      </header>
      <ProblemSplit enabled={doubleColumn} label={messages.problemResizeColumns}
        singlePane={surface === "reader" ? "primary" : "secondary"} onSplitChange={setSplit}
        secondary={<CodeDraft onFocus={() => setSurface("editor")} />}>
        <ProblemReader problem={problem} language={language} onLanguageChange={setLanguage}
          onFocus={() => setSurface("reader")} />
      </ProblemSplit>
    </section>
  );
}
