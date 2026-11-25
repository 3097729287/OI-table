import { useId, useLayoutEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMessages } from "../../i18n";
import { Scrollbar } from "../../shared/ui/Scrollbar";
import { SplitSeparator } from "../../shared/ui/SplitSeparator";
import { collectWorkspaceFrames, previewBounds, workspaceReducer,
  type LayoutAction, type Pane, type PaneBounds, type PaneFrame, type PaneId, type PaneSize, type SplitFrame } from "../../workspace/layout";
import { createProblemWorkspaceLayout, type ProblemWorkspaceTabId } from "./problemWorkspaceLayout";
import { useProblemTabDrag } from "./useProblemTabDrag";
import "./problem-workspace.css";

export type { ProblemWorkspaceTabId } from "./problemWorkspaceLayout";

export interface ProblemWorkspaceTab {
  id: ProblemWorkspaceTabId;
  label: string;
  content: ReactNode;
  lazy?: boolean;
}

interface ProblemWorkspaceProps {
  tabs: readonly ProblemWorkspaceTab[];
  enabled: boolean;
  labels: { tabs: string; resizeWidth: string; resizeHeight: string };
  actions?: ReactNode;
  activate?: { id: ProblemWorkspaceTabId };
  onSplitChange?(split: boolean): void;
}

const singlePaneId: PaneId = "pane--1";
const minimumWorkspaceWidth = 512;

function position({ x, y, width, height }: PaneBounds): CSSProperties {
  return { left: x, top: y, width, height };
}

// A tab has one portal host for its lifetime. Moving the host keeps editors and scrollports mounted.
function PanelHost({ parentId, children }: { parentId: string; children: ReactNode }) {
  const [host] = useState(() => {
    const element = document.createElement("div");
    element.className = "problem-workspace__host";
    return element;
  });

  useLayoutEffect(() => {
    const parent = host.ownerDocument.getElementById(parentId);
    if (!parent || parent === host.parentElement) return;
    if (host.isConnected && "moveBefore" in parent && typeof parent.moveBefore === "function") parent.moveBefore(host, null);
    else parent.appendChild(host);
  }, [host, parentId]);

  useLayoutEffect(() => () => host.remove(), [host]);

  return createPortal(children, host);
}

function WorkspaceSeparator({ frame, labels, controls, onResize }: {
  frame: SplitFrame;
  labels: ProblemWorkspaceProps["labels"];
  controls: string;
  onResize(ratio: number): void;
}) {
  const { axis, bounds, ratio, minRatio, maxRatio } = frame;
  const horizontal = axis === "horizontal";
  const span = horizontal ? bounds.width : bounds.height;
  return <SplitSeparator className="problem-workspace__separator" orientation={horizontal ? "vertical" : "horizontal"}
    label={horizontal ? labels.resizeWidth : labels.resizeHeight} controls={controls} value={ratio} min={minRatio}
    max={maxRatio} pixelsPerUnit={span} onResize={onResize} focusOnPointerDown
    style={horizontal ? { left: bounds.x + span * ratio, top: bounds.y, height: bounds.height }
      : { left: bounds.x, top: bounds.y + span * ratio, width: bounds.width }} />;
}

function WorkspaceTabs({ id, pane, label, dropEnd, children }: {
  id: string;
  pane: PaneId;
  label: string;
  dropEnd?: boolean;
  children: ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const messages = useMessages();

  return (
    <div className="problem-workspace__tabrail scrollbar-host">
      <div ref={viewport} id={id} className="problem-workspace__tabs" role="tablist"
        data-problem-tablist={pane} aria-label={label} data-drop-end={dropEnd}>
        {children}
      </div>
      <Scrollbar viewport={viewport} controls={id} orientation="horizontal" wheelOnParent
        label={messages.scrollEditorTabs.replace("{pane}", () => label)} />
    </div>
  );
}

export function ProblemWorkspace({ tabs, enabled, labels, actions, activate, onSplitChange }: ProblemWorkspaceProps) {
  const id = useId();
  const canvas = useRef<HTMLDivElement>(null);
  const tabToFocus = useRef<string>(undefined);
  const [size, setSize] = useState<PaneSize>({ width: 0, height: 0 });
  const [layout, dispatch] = useReducer(workspaceReducer, tabs,
    (initialTabs) => createProblemWorkspaceLayout(initialTabs.map((tab) => tab.id)));
  const [singleOrder, setSingleOrder] = useState<string[]>();
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set());
  const { panes: widePanes, splits: wideSplits } = useMemo(() => collectWorkspaceFrames(layout.root, size), [layout.root, size]);
  const wideByTab = useMemo(() => new Map(widePanes.flatMap((frame) =>
    frame.pane.tabs.map((tab) => [tab, frame.pane] as const))), [widePanes]);
  const focused = widePanes.find(({ pane }) => pane.id === layout.focused)?.pane.active;
  const docking = enabled && size.width >= minimumWorkspaceWidth && widePanes.every(({ bounds }) =>
    bounds.width >= 128 - 1e-6 && bounds.height >= 112 - 1e-6);
  const split = docking && widePanes.length > 1;
  const frames = useMemo<PaneFrame[]>(() => {
    if (docking || !focused) return widePanes;
    const pane: Pane = { kind: "pane", id: singlePaneId, tabs: singleOrder ?? [...wideByTab.keys()], active: focused };
    return [{ pane, bounds: { x: 0, y: 0, ...size } }];
  }, [docking, focused, singleOrder, size, wideByTab, widePanes]);
  const frameByPane = useMemo(() => new Map(frames.map((frame) => [frame.pane.id, frame])), [frames]);
  const frameByTab = useMemo(() => new Map(frames.flatMap((frame) =>
    frame.pane.tabs.map((tab) => [tab, frame] as const))), [frames]);
  const tabById = new Map<string, ProblemWorkspaceTab>(tabs.map((tab) => [tab.id, tab]));

  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) return;
    function measure({ width, height }: PaneSize) {
      setSize((current) => current.width === width && current.height === height ? current : { width, height });
    }
    measure(element.getBoundingClientRect());
    const observer = new ResizeObserver(([entry]) => measure(entry.contentRect));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => onSplitChange?.(split), [split, onSplitChange]);

  useLayoutEffect(() => {
    if (!activate || !layout.targets.has(activate.id)) return;
    if (!split) tabToFocus.current = activate.id;
    dispatch({ type: "open", view: activate.id, target: { id: activate.id, params: {} } });
  }, [activate]);

  useLayoutEffect(() => {
    const activeTabs = frames.map(({ pane }) => pane.active);
    setVisited((current) => activeTabs.every((tab) => current.has(tab)) ? current : new Set([...current, ...activeTabs]));
  }, [frames]);

  function tabId(tab: string) { return `${id}-problem-tab-${tab}`; }
  function bodyId(pane: PaneId) { return `${id}-problem-body-${pane}`; }
  function stripId(pane: PaneId) { return `${id}-problem-strip-${pane}`; }
  function panelId(tab: string) { return `${id}-problem-panel-${tab}`; }

  useLayoutEffect(() => {
    for (const { pane } of frames) {
      const tab = document.getElementById(tabId(pane.active));
      const strip = tab?.parentElement;
      if (!tab || !strip) continue;
      const itemBounds = tab.getBoundingClientRect();
      const stripBounds = strip.getBoundingClientRect();
      if (itemBounds.left < stripBounds.left) strip.scrollLeft += itemBounds.left - stripBounds.left;
      else if (itemBounds.right > stripBounds.right) strip.scrollLeft += itemBounds.right - stripBounds.right;
    }
  }, [frames]);

  useLayoutEffect(() => {
    const tab = tabToFocus.current;
    if (!tab || frameByTab.get(tab)?.pane.active !== tab) return;
    tabToFocus.current = undefined;
    document.getElementById(tabId(tab))?.focus({ preventScroll: true });
  });

  function select(tab: string) {
    const pane = wideByTab.get(tab);
    if (pane) dispatch({ type: "select", pane: pane.id, view: tab });
  }

  function dropTab(action: Extract<LayoutAction, { type: "split" | "place" }>) {
    tabToFocus.current = action.view;
    if (docking) {
      dispatch(action);
      if (action.type === "place" && action.from === action.destination.pane) select(action.view);
    } else if (action.type === "place" && frames[0]) {
      const next = workspaceReducer({ ...layout, root: frames[0].pane, focused: singlePaneId }, action);
      if (next.root?.kind === "pane") setSingleOrder(next.root.tabs);
      select(action.view);
    }
  }

  const drag = useProblemTabDrag(frameByPane, (action) => docking ? previewBounds(layout, action, size) : undefined, dropTab);
  const placed = drag.drop && "intoBody" in drag.drop ? drag.drop : undefined;
  const preview = drag.drop && "bounds" in drag.drop ? drag.drop.bounds : undefined;

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, pane: Pane, index: number) {
    const count = pane.tabs.length;
    let next: number;
    switch (event.key) {
      case "ArrowLeft": next = (index + count - 1) % count; break;
      case "ArrowRight": next = (index + 1) % count; break;
      case "Home": next = 0; break;
      case "End": next = count - 1; break;
      default: return;
    }
    event.preventDefault();
    select(pane.tabs[next]);
    document.getElementById(tabId(pane.tabs[next]))?.focus({ preventScroll: true });
  }

  return (
    <div ref={canvas} className="problem-workspace" data-problem-workspace data-problem-tab-dragging={drag.dragged !== undefined}
      onPointerDownCapture={drag.onPointerDownCapture} onClickCapture={drag.onClickCapture}
      onPointerMove={drag.track} onPointerUp={drag.finish} onPointerCancel={drag.cancel} onLostPointerCapture={drag.cancel}>
      {frames.map(({ pane, bounds }, index) => {
        const target = placed?.action.destination.pane === pane.id ? placed : undefined;
        return (
          <section key={pane.id} className="problem-workspace__pane" style={split ? position(bounds) : undefined}>
            <div className="problem-workspace__bar">
              <WorkspaceTabs id={stripId(pane.id)} pane={pane.id}
                label={frames.length > 1 ? `${labels.tabs} ${index + 1}` : labels.tabs}
                dropEnd={target && !target.intoBody && target.action.destination.anchor === null}>
                {pane.tabs.map((tab, tabIndex) => {
                  const item = tabById.get(tab);
                  if (!item) return null;
                  const selected = tab === pane.active;
                  const destination = target?.action.destination;
                  const edge = destination?.anchor === tab && tab !== drag.dragged
                    ? destination.after ? "after" : "before" : undefined;
                  return <button key={tab} id={tabId(tab)} className="problem-workspace__tab" type="button" role="tab"
                    data-problem-tab={tab} data-dragged={drag.dragged === tab} data-drop-edge={edge}
                    aria-selected={selected} aria-controls={panelId(tab)} tabIndex={selected ? 0 : -1}
                    title={item.label} onClick={() => select(tab)} onPointerDown={(event) => drag.start(event, pane.id, tab)}
                    onKeyDown={(event) => moveTab(event, pane, tabIndex)}>{item.label}</button>;
                })}
              </WorkspaceTabs>
              {index === 0 && actions && <div className="problem-workspace__actions">{actions}</div>}
            </div>
            <div id={bodyId(pane.id)} className="problem-workspace__body" data-problem-drop-body={pane.id}
              data-drop-target={target?.intoBody}
              onFocusCapture={() => { if (docking) dispatch({ type: "focus", pane: pane.id }); }}
              onPointerDown={() => { if (docking) dispatch({ type: "focus", pane: pane.id }); }} />
          </section>
        );
      })}
      {tabs.map((tab) => {
        const pane = frameByTab.get(tab.id)?.pane;
        if (!pane) return null;
        const active = pane.active === tab.id;
        return (
          <PanelHost key={tab.id} parentId={bodyId(pane.id)}>
            <div id={panelId(tab.id)} className="problem-workspace__panel" role="tabpanel"
              aria-labelledby={tabId(tab.id)} tabIndex={0} hidden={!active}
              onFocusCapture={() => { if (docking) dispatch({ type: "focus", pane: pane.id }); }}
              onPointerDown={() => { if (docking) dispatch({ type: "focus", pane: pane.id }); }}>
              {(!tab.lazy || active || visited.has(tab.id)) && tab.content}
            </div>
          </PanelHost>
        );
      })}
      {split && wideSplits.map((frame) => <WorkspaceSeparator key={`${frame.id}:${frame.primaryPane}`}
        frame={frame} labels={labels} controls={stripId(frame.primaryPane)}
        onResize={(ratio) => dispatch({ type: "resize", frame, ratio })} />)}
      {preview && <div className="problem-workspace__preview" style={position(preview)} aria-hidden="true" />}
    </div>
  );
}
