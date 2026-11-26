import type { WorkspaceTarget } from "../workspace/layout";
import type { LocalizedProblemText } from "./problemLibrary";

export function problemTarget(id: string, title: LocalizedProblemText): WorkspaceTarget {
  return {
    id: "problem",
    params: { problemId: id },
    label: { "zh-CN": title.zhCN ?? undefined, en: title.en ?? undefined },
  };
}
