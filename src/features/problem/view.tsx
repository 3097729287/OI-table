import { lazy, Suspense, useContext, useEffect, useState } from "react";
import { getMessages, LocaleContext } from "../../i18n";
import {
  getLibraryProblem, getLibraryRevision, localizedLibraryText, useLibraryRevision, type LibraryProblemDetail,
} from "../../shared/problemLibrary";
import { StatusMessage } from "../../shared/StatusMessage";
import type { WorkspaceViewOptions, WorkspaceViewProps } from "../../workspace/views";
import "./problem-preview.css";

const MarkdownViewer = lazy(() => import("../../shared/ui/MarkdownViewer"));

export const workspaceView = {
  id: "problem",
  title: "problem",
  icon: "problems",
  section: "catalog",
  sidebarTitle: false,
  order: 16,
} satisfies WorkspaceViewOptions;

export default function ProblemView({ params, title }: WorkspaceViewProps) {
  const { problemId } = params;
  const locale = useContext(LocaleContext);
  const messages = getMessages(locale);
  const revision = useLibraryRevision();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ id: string; problem: LibraryProblemDetail | null }>();
  const problem = result && result.id === problemId ? result.problem : undefined;

  useEffect(() => {
    if (!problemId) return;

    let current = true;
    void getLibraryProblem(problemId).then(
      (detail) => {
        if (current && revision === getLibraryRevision()) setResult({ id: problemId, problem: detail });
      },
      () => {
        if (current && revision === getLibraryRevision()) setResult({ id: problemId, problem: null });
      },
    );
    return () => { current = false; };
  }, [problemId, revision, attempt]);

  const heading = problem ? localizedLibraryText(problem.title, locale) || title : title;
  const statement = problem ? localizedLibraryText(problem.statement, locale) : undefined;

  return (
    <section className="workspace workbench-page problem-preview">
      <h1 data-selectable>{heading}</h1>
      {(!problemId || problem === null) && (
        <>
          <StatusMessage state="error">{messages.problemLoadError}</StatusMessage>
          {problemId && (
            <button type="button" className="problem-preview__retry" onClick={() => setAttempt((count) => count + 1)}>
              {messages.retry}
            </button>
          )}
        </>
      )}
      {problemId && problem === undefined && <StatusMessage state="loading">{messages.problemLoading}</StatusMessage>}
      {problem && (statement?.trim()
        ? <div className="problem-preview__statement">
          <Suspense fallback={<StatusMessage state="loading">{messages.problemLoading}</StatusMessage>}>
            <MarkdownViewer source={statement} />
          </Suspense>
        </div>
        : <StatusMessage state="empty">{messages.problemStatementEmpty}</StatusMessage>)}
    </section>
  );
}
