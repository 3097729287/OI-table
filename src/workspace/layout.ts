export type PaneId = `pane-${number}`;
export type SplitEdge = "left" | "right" | "top" | "bottom";
type SplitAxis = "horizontal" | "vertical";

export interface TabDestination {
  pane: PaneId;
  anchor: string | null;
  after: boolean;
}

export interface Pane {
  kind: "pane";
  id: PaneId;
  tabs: string[];
  active: string;
}

type PaneNode = Pane | {
  kind: "split";
  axis: SplitAxis;
  first: PaneNode;
  second: PaneNode;
};

export interface Layout {
  root: PaneNode | null;
  focused: PaneId | null;
  nextPaneId: number;
}

export interface PaneBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PaneFrame {
  pane: Pane;
  bounds: PaneBounds;
}

export type LayoutAction =
  | { type: "open"; view: string }
  | { type: "select"; pane: PaneId; view: string }
  | { type: "focus"; pane: PaneId }
  | { type: "close"; pane: PaneId; view: string }
  | { type: "place"; from: PaneId; view: string; destination: TabDestination }
  | { type: "split"; from: PaneId; target: PaneId; view: string; edge: SplitEdge };

export const initialLayout: Layout = {
  root: null,
  focused: null,
  nextPaneId: 0,
};

function createPane(nextPaneId: number, view: string): Pane {
  return { kind: "pane", id: `pane-${nextPaneId}`, tabs: [view], active: view };
}

function findPane(node: PaneNode, matches: (pane: Pane) => boolean): Pane | undefined {
  if (node.kind === "pane") return matches(node) ? node : undefined;
  return findPane(node.first, matches) ?? findPane(node.second, matches);
}

function replacePane(node: PaneNode, id: PaneId, replacement: PaneNode | null): PaneNode | null {
  if (node.kind === "pane") return node.id === id ? replacement : node;
  const first = replacePane(node.first, id, replacement);
  const second = replacePane(node.second, id, replacement);
  if (!first || !second) return first ?? second;
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

function removeTab(pane: Pane, view: string): Pane | null {
  const index = pane.tabs.indexOf(view);
  const tabs = pane.tabs.filter((tab) => tab !== view);
  if (tabs.length === 0) return null;
  const active = pane.active === view ? tabs[Math.min(index, tabs.length - 1)] : pane.active;
  return { ...pane, tabs, active };
}

function removeFromTree(root: PaneNode, source: Pane, view: string): PaneNode | null {
  return replacePane(root, source.id, removeTab(source, view));
}

function splitDirection(edge: SplitEdge) {
  return {
    axis: edge === "left" || edge === "right" ? "horizontal" as const : "vertical" as const,
    leading: edge === "left" || edge === "top",
  };
}

function splitBounds(bounds: PaneBounds, axis: SplitAxis): [PaneBounds, PaneBounds] {
  if (axis === "horizontal") {
    const width = bounds.width / 2;
    return [{ ...bounds, width }, { ...bounds, x: bounds.x + width, width }];
  }
  const height = bounds.height / 2;
  return [{ ...bounds, height }, { ...bounds, y: bounds.y + height, height }];
}

export function previewBounds(bounds: PaneBounds, edge: SplitEdge): PaneBounds {
  const { axis, leading } = splitDirection(edge);
  return splitBounds(bounds, axis)[leading ? 0 : 1];
}

export function collectPaneFrames(root: PaneNode | null): PaneFrame[] {
  const frames: PaneFrame[] = [];
  function visit(node: PaneNode, bounds: PaneBounds) {
    if (node.kind === "pane") {
      frames.push({ pane: node, bounds });
      return;
    }
    const [first, second] = splitBounds(bounds, node.axis);
    visit(node.first, first);
    visit(node.second, second);
  }
  if (root) visit(root, { x: 0, y: 0, width: 100, height: 100 });
  return frames;
}

export function workspaceReducer(layout: Layout, action: LayoutAction): Layout {
  const { root } = layout;
  if (!root) {
    if (action.type !== "open") return layout;
    const pane = createPane(layout.nextPaneId, action.view);
    return { root: pane, focused: pane.id, nextPaneId: layout.nextPaneId + 1 };
  }

  const paneById = (id: PaneId | null) => findPane(root, (pane) => pane.id === id);

  switch (action.type) {
    case "open": {
      const existing = findPane(root, (pane) => pane.tabs.includes(action.view));
      const pane = existing ?? paneById(layout.focused);
      if (!pane) return layout;
      const tabs = existing ? pane.tabs : [...pane.tabs, action.view];
      const nextRoot = replacePane(root, pane.id, { ...pane, tabs, active: action.view });
      return { ...layout, root: nextRoot, focused: pane.id };
    }
    case "select": {
      const pane = paneById(action.pane);
      if (!pane?.tabs.includes(action.view)) return layout;
      const nextRoot = pane.active === action.view ? root
        : replacePane(root, pane.id, { ...pane, active: action.view });
      return { ...layout, root: nextRoot, focused: pane.id };
    }
    case "focus":
      if (layout.focused === action.pane || !paneById(action.pane)) return layout;
      return { ...layout, focused: action.pane };
    case "close": {
      const pane = paneById(action.pane);
      if (!pane?.tabs.includes(action.view)) return layout;
      const nextRoot = removeFromTree(root, pane, action.view);
      if (!nextRoot) return { ...layout, root: null, focused: null };
      const focused = findPane(nextRoot, (candidate) => candidate.id === layout.focused)
        ?? findPane(nextRoot, () => true)!;
      return { ...layout, root: nextRoot, focused: focused.id };
    }
    case "place": {
      const { pane, anchor, after } = action.destination;
      const source = paneById(action.from);
      const target = paneById(pane);
      if (!source?.tabs.includes(action.view) || !target || anchor === action.view) return layout;

      const tabs = target.tabs.filter((tab) => tab !== action.view);
      const index = anchor === null ? -1 : tabs.indexOf(anchor);
      tabs.splice(index < 0 ? tabs.length : index + Number(after), 0, action.view);
      if (source.id === target.id && tabs.every((tab, position) => tab === source.tabs[position])) {
        return layout;
      }
      const active = source.id === target.id ? target.active : action.view;
      const inserted = replacePane(root, target.id, { ...target, tabs, active })!;
      const nextRoot = source.id === target.id ? inserted : removeFromTree(inserted, source, action.view);
      return { ...layout, root: nextRoot, focused: target.id };
    }
    case "split": {
      const source = paneById(action.from);
      const target = paneById(action.target);
      if (!source?.tabs.includes(action.view) || !target) return layout;
      const samePane = source.id === target.id;
      const remaining = samePane ? removeTab(source, action.view) : target;
      if (!remaining) return layout;

      const detached = createPane(layout.nextPaneId, action.view);
      const { axis, leading } = splitDirection(action.edge);
      const branched = replacePane(root, target.id, {
        kind: "split",
        axis,
        first: leading ? detached : remaining,
        second: leading ? remaining : detached,
      })!;
      const nextRoot = samePane ? branched : removeFromTree(branched, source, action.view);
      return { root: nextRoot, focused: detached.id, nextPaneId: layout.nextPaneId + 1 };
    }
  }
}
