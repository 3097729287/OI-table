import { initialLayout, type Layout, type Pane, type SplitAxis, type SplitId } from "../../workspace/layout";

export type ProblemWorkspaceTabId = "statement" | "solutions" | "submissions" | "code" | "input" | "output";

type Node = NonNullable<Layout["root"]>;

function split(axis: SplitAxis, id: SplitId, first: Node | undefined, second: Node | undefined, firstWeight: number) {
  if (!first || !second) return first ?? second;
  return { kind: "split", id, axis, children: [
    { node: first, weight: firstWeight }, { node: second, weight: 1 - firstWeight },
  ] } satisfies Node;
}

export function createProblemWorkspaceLayout(ids: readonly ProblemWorkspaceTabId[]): Layout {
  function pane(id: Pane["id"], group: ProblemWorkspaceTabId[]): Pane | undefined {
    const tabs = group.filter((tab) => ids.includes(tab));
    return tabs[0] ? { kind: "pane", id, tabs, active: tabs[0] } : undefined;
  }

  const reading = pane("pane-0", ["statement", "solutions", "submissions"]);
  const editor = pane("pane-1", ["code"]);
  const testing = pane("pane-2", ["input", "output"]);
  const right = split("vertical", "split-0", editor, testing, 0.67);
  const root = split("horizontal", "split-1", reading, right, 0.44);
  return {
    ...initialLayout,
    root: root ?? null,
    focused: (reading ?? editor ?? testing)?.id ?? null,
    nextPaneId: 3,
    targets: new Map(ids.map((id) => [id, { id, params: {} }])),
  };
}
