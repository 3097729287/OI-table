import { useEffect, useState } from "react";
import { t } from "../../i18n";
import {
  getLibraryProblem, getLibraryRevision, useLibraryRevision, type LibraryProblemDetail,
} from "../../shared/problemLibrary";
import { useSettings } from "../../shared/settings";
import { DelayedLoadingMessage, StatusMessage } from "../../shared/StatusMessage";
import type { WorkspaceViewOptions, WorkspaceViewProps } from "../../workspace/views";
import { ProblemDetail } from "./ProblemDetail";
import "./problem-preview.css";

export const workspaceView = {
  id: "problem",
  title: "problem",
  icon: "problems",
} satisfies WorkspaceViewOptions;

export default function ProblemView({ params, title }: WorkspaceViewProps) {
  const { problemId } = params;
  const { settings, loadFailed } = useSettings();
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

  if (problem && settings) {
    return <ProblemDetail key={problem.id} problem={problem} title={title} settings={settings} />;
  }

  return (
    <section className="workspace workbench-page problem-preview" aria-label={title}>
      {(!problemId || problem === null) && (
        <>
          <StatusMessage state="error">{t("problemLoadError")}</StatusMessage>
          {problemId && (
            <button type="button" className="problem-preview__retry" onClick={() => setAttempt((count) => count + 1)}>
              {t("retry")}
            </button>
          )}
        </>
      )}
      {problemId && problem === undefined && <DelayedLoadingMessage>{t("problemLoading")}</DelayedLoadingMessage>}
      {problem && (loadFailed
        ? <StatusMessage state="error">{t("settingsLoadFailed")}</StatusMessage>
        : <DelayedLoadingMessage>{t("settingsLoading")}</DelayedLoadingMessage>)}
    </section>
  );
}
