import { useEffect, useState } from "react";
import { useMessages } from "../../i18n";
import {
  getLibraryProblem, getLibraryRevision, useLibraryRevision, type LibraryProblemDetail,
} from "../../shared/problemLibrary";
import { StatusMessage } from "../../shared/StatusMessage";
import type { WorkspaceViewOptions, WorkspaceViewProps } from "../../workspace/views";
import { ProblemDetail } from "./ProblemDetail";
import "./problem-preview.css";

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
  const messages = useMessages();
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

  if (problem) return <ProblemDetail key={problem.id} problem={problem} title={title} />;

  return (
    <section className="workspace workbench-page problem-preview">
      <h1 data-selectable>{title}</h1>
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
    </section>
  );
}
