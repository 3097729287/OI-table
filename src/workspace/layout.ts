export type WorkspaceParams = Readonly<Record<string, string>>;

export interface WorkspaceTarget {
  id: string;
  params: WorkspaceParams;
  label?: Readonly<Partial<Record<"en" | "zh-CN", string>>>;
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

type PaneNode = Pane | SplitGroup;

interface SplitGroup {
  kind: "split";
  id: SplitId;
  axis: SplitAxis;
  children: { node: PaneNode; weight: number }[];
}

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
  index: number;
  sizes: number[];
  axis: SplitAxis;
  bounds: PaneBounds;
  ratio: number;
  minRatio: number;
  maxRatio: number;
  primaryPane: PaneId;
}

export type LayoutAction =
  | { type: "open"; view: string; target: WorkspaceTarget }
  | { type: "select"; pane?: PaneId; view: string }
  | { type: "focus"; pane: PaneId }
  | { type: "close"; pane: PaneId; view: string; scope?: TabCloseScope }
  | { type: "place"; from: PaneId; view: string; destination: TabDestination }
  | { type: "split"; from: PaneId; target: PaneId; view: string; edge: SplitEdge }
  | { type: "resize"; frame: SplitFrame; ratio: number };

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
  for (const child of node.children) {
    const found = findPane(child.node, matches);
    if (found) return found;
  }
}

function replaceNode(node: PaneNode, id: PaneId | SplitId, replacement: PaneNode | null): PaneNode | null {
  if (node.id === id) return replacement;
  if (node.kind === "pane") return node;
  for (const [index, child] of node.children.entries()) {
    const next = replaceNode(child.node, id, replacement);
    if (next === child.node) continue;
    const children = [...node.children];
    if (!next) {
      children.splice(index, 1);
      if (children.length === 1) return children[0].node;
    } else if (next.kind === "split" && next.axis === node.axis) {
      // Collapsing a perpendicular group can expose grandchildren on this axis.
      const total = next.children.reduce((sum, item) => sum + item.weight, 0);
      children.splice(index, 1, ...next.children.map((item) => ({
        node: item.node, weight: child.weight * item.weight / total,
      })));
    } else {
      children[index] = { ...child, node: next };
    }
    return { ...node, children };
  }
  return node;
}

function parentGroup(node: PaneNode, pane: PaneId): SplitGroup | undefined {
  if (node.kind === "pane") return;
  if (node.children.some(child => child.node.id === pane)) return node;
  for (const child of node.children) {
    const parent = parentGroup(child.node, pane);
    if (parent) return parent;
  }
}

function insertBeside(root: PaneNode, target: Pane, pane: Pane, axis: SplitAxis, leading: boolean, id: SplitId): PaneNode {
  const group = parentGroup(root, target.id);
  if (group?.axis === axis) {
    const existing = group.children.find(child => child.node.id === pane.id);
    const children = group.children.filter(child => child !== existing);
    const index = children.findIndex(child => child.node.id === target.id);
    const weight = children.reduce((sum, item) => sum + item.weight, 0) / children.length;
    children.splice(index + (leading ? 0 : 1), 0, existing ?? { node: pane, weight });
    return replaceNode(root, group.id, { ...group, children })!;
  }
  const nodes = leading ? [pane, target] : [target, pane];
  return replaceNode(root, target.id, { kind: "split", id, axis, children: nodes.map(node => ({ node, weight: 1 })) })!;
}

function resizeSplit(node: PaneNode, frame: SplitFrame, ratio: number): PaneNode {
  if (node.kind === "pane") return node;
  if (node.id === frame.id) {
    const { index, sizes } = frame;
    if (sizes.length !== node.children.length || ratio === frame.ratio) return node;
    const pair = sizes[index] + sizes[index + 1];
    const weights = [...sizes];
    weights.splice(index, 2, pair * ratio, pair * (1 - ratio));
    return { ...node, children: node.children.map((child, i) => ({ ...child, weight: weights[i] })) };
  }
  for (const [index, child] of node.children.entries()) {
    const next = resizeSplit(child.node, frame, ratio);
    if (next === child.node) continue;
    const children = [...node.children];
    children[index] = { ...child, node: next };
    return { ...node, children };
  }
  return node;
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
  return replaceNode(root, source.id, closePaneTabs(source, view));
}

function splitDirection(edge: SplitEdge) {
  return {
    axis: edge === "left" || edge === "right" ? "horizontal" as const : "vertical" as const,
    leading: edge === "left" || edge === "top",
  };
}

function measureMinimums(node: PaneNode, minimums: Map<PaneNode, PaneSize>): PaneSize {
  if (node.kind === "pane") return minimumPaneSize;
  const sizes = node.children.map((child) => measureMinimums(child.node, minimums));
  const size = node.axis === "horizontal"
    ? { width: sizes.reduce((sum, s) => sum + s.width, 0), height: Math.max(...sizes.map(s => s.height)) }
    : { width: Math.max(...sizes.map(s => s.width)), height: sizes.reduce((sum, s) => sum + s.height, 0) };
  minimums.set(node, size);
  return size;
}

function distributeSpan(span: number, children: SplitGroup["children"], minima: number[]): number[] {
  const minimum = minima.reduce((sum, value) => sum + value, 0);
  if (span <= minimum) return minima.map(value => span * value / minimum);

  // Reserve constrained panes first, then share the remainder by preferred weight.
  const sizes = [...minima];
  let pending = children.map((_, index) => index);
  while (pending.length) {
    const weight = pending.reduce((sum, i) => sum + children[i].weight, 0);
    const unit = span / weight;
    const flexible = pending.filter(i => children[i].weight * unit >= minima[i]);
    if (flexible.length === pending.length) {
      for (const i of flexible) sizes[i] = children[i].weight * unit;
      break;
    }
    for (const i of pending) {
      if (children[i].weight * unit < minima[i]) span -= minima[i];
    }
    pending = flexible;
  }
  return sizes;
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
    const origin = node.axis === "horizontal" ? "x" : "y";
    const minima = node.children.map(child => (minimums.get(child.node) ?? minimumPaneSize)[dimension]);
    const sizes = distributeSpan(bounds[dimension], node.children, minima);
    let offset = bounds[origin];
    node.children.forEach(({ node: child }, index) => {
      const childBounds = { ...bounds, [origin]: offset, [dimension]: sizes[index] };
      visit(child, childBounds);
      if (index + 1 < sizes.length) {
        const pair = sizes[index] + sizes[index + 1];
        const totalMin = minima[index] + minima[index + 1];
        const ratio = pair > 0 ? sizes[index] / pair : minima[index] / totalMin;
        splits.push({
          id: node.id, index, sizes, axis: node.axis, bounds: { ...childBounds, [dimension]: pair },
          ratio, minRatio: pair > totalMin ? minima[index] / pair : ratio,
          maxRatio: pair > totalMin ? 1 - minima[index + 1] / pair : ratio,
          primaryPane: findPane(child, () => true)!.id,
        });
      }
      offset += sizes[index];
    });
  }

  if (root) {
    measureMinimums(root, minimums);
    visit(root, { x: 0, y: 0, ...size });
  }
  return { panes, splits };
}

export function previewBounds(
  layout: Layout, action: Extract<LayoutAction, { type: "split" }>, size: PaneSize, targetBounds: PaneBounds,
): PaneBounds | undefined {
  const next = workspaceReducer(layout, action);
  if (next === layout) return;

  const { panes } = collectWorkspaceFrames(next.root, size);
  const fits = panes.every(({ bounds }) => bounds.width >= minimumPaneSize.width - 1e-6 &&
    bounds.height >= minimumPaneSize.height - 1e-6);
  if (!fits) return;

  const { axis, leading } = splitDirection(action.edge);
  const [dimension, origin] = axis === "horizontal" ? ["width", "x"] as const : ["height", "y"] as const;
  const half = targetBounds[dimension] / 2;
  return { ...targetBounds, [origin]: targetBounds[origin] + (leading ? 0 : half), [dimension]: half };
}

function sameTarget(current: WorkspaceTarget | undefined, next: WorkspaceTarget): boolean {
  if (!current || current.id !== next.id) return false;
  if (current.label?.en !== next.label?.en || current.label?.["zh-CN"] !== next.label?.["zh-CN"]) return false;

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
      const nextRoot = replaceNode(root, pane.id, { ...pane, tabs, active: action.view });
      return { ...layout, root: nextRoot, focused: pane.id, targets };
    }
    case "select": {
      const pane = action.pane === undefined ? findPane(root, (candidate) => candidate.tabs.includes(action.view))
        : paneById(action.pane);
      if (!pane?.tabs.includes(action.view)) return layout;
      const nextRoot = pane.active === action.view ? root
        : replaceNode(root, pane.id, { ...pane, active: action.view });
      return { ...layout, root: nextRoot, focused: pane.id };
    }
    case "focus":
      if (layout.focused === action.pane || !paneById(action.pane)) return layout;
      return { ...layout, focused: action.pane };
    case "resize": {
      if (!Number.isFinite(action.ratio)) return layout;
      const ratio = Math.min(action.frame.maxRatio, Math.max(action.frame.minRatio, action.ratio));
      const nextRoot = resizeSplit(root, action.frame, ratio);
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
      const nextRoot = replaceNode(root, pane.id, remaining);
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
      const inserted = replaceNode(root, target.id, { ...target, tabs, active })!;
      const nextRoot = source.id === target.id ? inserted : removeFromTree(inserted, source, action.view);
      return { ...layout, root: nextRoot, focused: target.id };
    }
    case "split": {
      const source = paneById(action.from);
      const target = paneById(action.target);
      if (!source?.tabs.includes(action.view) || !target) return layout;
      if (source.id === target.id && source.tabs.length === 1) return layout;
      const { axis, leading } = splitDirection(action.edge);
      const movingPane = source.tabs.length === 1;
      const group = movingPane ? parentGroup(root, target.id) : undefined;
      const reorder = group?.axis === axis && group.children.some(child => child.node.id === source.id);
      const remaining = reorder ? root : removeFromTree(root, source, action.view)!;
      const detached = movingPane ? source : createPane(layout.nextPaneId, action.view);
      const destination = source.id === target.id ? findPane(remaining, pane => pane.id === target.id)! : target;
      const nextRoot = insertBeside(remaining, destination, detached, axis, leading, `split-${layout.nextPaneId}`);
      return { ...layout, root: nextRoot, focused: detached.id, nextPaneId: layout.nextPaneId + 1 };
    }
  }
}
