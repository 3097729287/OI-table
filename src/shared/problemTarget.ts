import type { WorkspaceTarget } from "../workspace/layout";
import { libraryTextLabels, type LocalizedProblemText } from "./problemLibrary";

export function problemTarget(id: string, title: LocalizedProblemText): WorkspaceTarget {
  return {
    id: "problem",
    params: { problemId: id },
    label: libraryTextLabels(title),
  };
}
