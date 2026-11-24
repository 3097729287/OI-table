export type WorkspaceParams = Readonly<Record<string, string>>;

export interface WorkspaceTarget {
  id: string;
  params: WorkspaceParams;
}

export function workspaceTabId(target: WorkspaceTarget, singleton = false): string {
  if (singleton) return target.id;

  const params = new URLSearchParams(target.params);
  params.sort();
  const query = params.toString();
  return query ? `${target.id}?${query}` : target.id;
}

export type PaneId = `pane-${number}`;
export type SplitId = `split-${number}`;
export type SplitAxis = "horizontal" | "vertical";
export type SplitEdge = "left" | "right" | "top" | "bottom";
export type TabCloseScope = "current" | "left" | "right" | "others" | "all";

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
  id: SplitId;
  axis: SplitAxis;
  ratio: number;
  first: PaneNode;
  second: PaneNode;
};

export interface Layout {
  root: PaneNode | null;
  focused: PaneId | null;
  nextPaneId: number;
  readonly targets: ReadonlyMap<string, WorkspaceTarget>;
}

export interface PaneSize {
  width: number;
  height: number;
}

export interface PaneBounds extends PaneSize {
  x: number;
  y: number;
}

export interface PaneFrame {
  pane: Pane;
  bounds: PaneBounds;
}

export interface SplitFrame {
  id: SplitId;
  axis: SplitAxis;
  bounds: PaneBounds;
  ratio: number;
  minRatio: number;
  maxRatio: number;
  primaryPane: PaneId;
}

export type LayoutAction =
  | { type: "open"; view: string; target: WorkspaceTarget }
  | { type: "select"; pane: PaneId; view: string }
  | { type: "focus"; pane: PaneId }
  | { type: "close"; pane: PaneId; view: string; scope?: TabCloseScope }
  | { type: "place"; from: PaneId; view: string; destination: TabDestination }
  | { type: "split"; from: PaneId; target: PaneId; view: string; edge: SplitEdge }
  | { type: "resize"; split: SplitId; ratio: number };

const minimumPaneSize: PaneSize = { width: 128, height: 112 };

export const initialLayout: Layout = {
  root: null,
  focused: null,
  nextPaneId: 0,
  targets: new Map(),
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

function resizeSplit(node: PaneNode, id: SplitId, ratio: number): PaneNode {
  if (node.kind === "pane") return node;
  if (node.id === id) return node.ratio === ratio ? node : { ...node, ratio };
  const first = resizeSplit(node.first, id, ratio);
  const second = resizeSplit(node.second, id, ratio);
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

export function closePaneTabs(pane: Pane, view: string, scope: TabCloseScope = "current"): Pane | null {
  const index = pane.tabs.indexOf(view);
  if (index < 0) return pane;

  let tabs: string[];
  switch (scope) {
    case "current": tabs = pane.tabs.filter((tab) => tab !== view); break;
    case "left": tabs = pane.tabs.slice(index); break;
    case "right": tabs = pane.tabs.slice(0, index + 1); break;
    case "others": tabs = [view]; break;
    case "all": return null;
  }
  if (tabs.length === pane.tabs.length) return pane;
  if (tabs.length === 0) return null;

  let active = pane.active;
  if (!tabs.includes(active)) {
    const activeIndex = pane.tabs.indexOf(active);
    const remaining = new Set(tabs);
    active = pane.tabs.find((tab, index) => index > activeIndex && remaining.has(tab))
      ?? tabs[tabs.length - 1];
  }
  return { ...pane, tabs, active };
}

function removeFromTree(root: PaneNode, source: Pane, view: string): PaneNode | null {
  return replacePane(root, source.id, closePaneTabs(source, view));
}

function splitDirection(edge: SplitEdge) {
  return {
    axis: edge === "left" || edge === "right" ? "horizontal" as const : "vertical" as const,
    leading: edge === "left" || edge === "top",
  };
}

function splitBounds(bounds: PaneBounds, axis: SplitAxis, ratio: number): [PaneBounds, PaneBounds] {
  if (axis === "horizontal") {
    const width = bounds.width * ratio;
    return [{ ...bounds, width }, { ...bounds, x: bounds.x + width, width: bounds.width - width }];
  }
  const height = bounds.height * ratio;
  return [{ ...bounds, height }, { ...bounds, y: bounds.y + height, height: bounds.height - height }];
}

function measureMinimums(node: PaneNode, minimums: Map<PaneNode, PaneSize>): PaneSize {
  if (node.kind === "pane") return minimumPaneSize;
  const first = measureMinimums(node.first, minimums);
  const second = measureMinimums(node.second, minimums);
  const size = node.axis === "horizontal"
    ? { width: first.width + second.width, height: Math.max(first.height, second.height) }
    : { width: Math.max(first.width, second.width), height: first.height + second.height };
  minimums.set(node, size);
  return size;
}

export function collectWorkspaceFrames(root: PaneNode | null, size: PaneSize): {
  panes: PaneFrame[];
  splits: SplitFrame[];
} {
  const panes: PaneFrame[] = [];
  const splits: SplitFrame[] = [];
  const minimums = new Map<PaneNode, PaneSize>();

  function visit(node: PaneNode, bounds: PaneBounds) {
    if (node.kind === "pane") {
      panes.push({ pane: node, bounds });
      return;
    }
    const dimension = node.axis === "horizontal" ? "width" : "height";
    const firstMin = (minimums.get(node.first) ?? minimumPaneSize)[dimension];
    const secondMin = (minimums.get(node.second) ?? minimumPaneSize)[dimension];
    const span = bounds[dimension];
    const totalMin = firstMin + secondMin;
    // When both minima cannot fit, divide the available space in proportion to them.
    const minRatio = span > totalMin ? firstMin / span : firstMin / totalMin;
    const maxRatio = span > totalMin ? 1 - secondMin / span : minRatio;
    const ratio = Math.min(maxRatio, Math.max(minRatio, node.ratio));
    splits.push({
      id: node.id,
      axis: node.axis,
      bounds,
      ratio,
      minRatio,
      maxRatio,
      primaryPane: findPane(node.first, () => true)!.id,
    });
    const [first, second] = splitBounds(bounds, node.axis, ratio);
    visit(node.first, first);
    visit(node.second, second);
  }

  if (root) {
    measureMinimums(root, minimums);
    visit(root, { x: 0, y: 0, ...size });
  }
  return { panes, splits };
}

export function previewBounds(
  layout: Layout, action: Extract<LayoutAction, { type: "split" }>, size: PaneSize,
): PaneBounds | undefined {
  const next = workspaceReducer(layout, action);
  if (next === layout) return;

  const { panes } = collectWorkspaceFrames(next.root, size);
  const fits = panes.every(({ bounds }) => bounds.width >= minimumPaneSize.width - 1e-6 &&
    bounds.height >= minimumPaneSize.height - 1e-6);
  if (fits) return panes.find(({ pane }) => pane.id === next.focused)?.bounds;
}

function sameTarget(current: WorkspaceTarget | undefined, next: WorkspaceTarget): boolean {
  if (!current || current.id !== next.id) return false;

  const params = Object.entries(next.params);
  return Object.keys(current.params).length === params.length
    && params.every(([key, value]) => current.params[key] === value);
}

export function workspaceReducer(layout: Layout, action: LayoutAction): Layout {
  const { root } = layout;
  if (!root) {
    if (action.type !== "open") return layout;
    const pane = createPane(layout.nextPaneId, action.view);
    return {
      root: pane,
      focused: pane.id,
      nextPaneId: layout.nextPaneId + 1,
      targets: new Map([[action.view, action.target]]),
    };
  }

  const paneById = (id: PaneId | null) => findPane(root, (pane) => pane.id === id);

  switch (action.type) {
    case "open": {
      const existing = findPane(root, (pane) => pane.tabs.includes(action.view));
      const pane = existing ?? paneById(layout.focused);
      if (!pane) return layout;
      const targets = sameTarget(layout.targets.get(action.view), action.target)
        ? layout.targets
        : new Map(layout.targets).set(action.view, action.target);
      if (pane.active === action.view) {
        if (layout.focused === pane.id && targets === layout.targets) return layout;
        return { ...layout, focused: pane.id, targets };
      }

      let tabs = pane.tabs;
      if (!existing) {
        tabs = [...tabs];
        tabs.splice(tabs.indexOf(pane.active) + 1, 0, action.view);
      }
      const nextRoot = replacePane(root, pane.id, { ...pane, tabs, active: action.view });
      return { ...layout, root: nextRoot, focused: pane.id, targets };
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
    case "resize": {
      if (!Number.isFinite(action.ratio)) return layout;
      const ratio = Math.min(1, Math.max(0, action.ratio));
      const nextRoot = resizeSplit(root, action.split, ratio);
      return nextRoot === root ? layout : { ...layout, root: nextRoot };
    }
    case "close": {
      const pane = paneById(action.pane);
      if (!pane) return layout;
      const remaining = closePaneTabs(pane, action.view, action.scope);
      if (remaining === pane) return layout;
      const targets = new Map(layout.targets);
      for (const tab of pane.tabs) {
        if (!remaining?.tabs.includes(tab)) targets.delete(tab);
      }
      const nextRoot = replacePane(root, pane.id, remaining);
      if (!nextRoot) return { ...layout, root: null, focused: null, targets };
      const focused = findPane(nextRoot, (candidate) => candidate.id === layout.focused)
        ?? findPane(nextRoot, () => true)!;
      return { ...layout, root: nextRoot, focused: focused.id, targets };
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
      const remaining = samePane ? closePaneTabs(source, action.view) : target;
      if (!remaining) return layout;

      const detached = createPane(layout.nextPaneId, action.view);
      const { axis, leading } = splitDirection(action.edge);
      const branched = replacePane(root, target.id, {
        kind: "split",
        id: `split-${layout.nextPaneId}`,
        axis,
        ratio: 0.5,
        first: leading ? detached : remaining,
        second: leading ? remaining : detached,
      })!;
      const nextRoot = samePane ? branched : removeFromTree(branched, source, action.view);
      return { ...layout, root: nextRoot, focused: detached.id, nextPaneId: layout.nextPaneId + 1 };
    }
  }
}
