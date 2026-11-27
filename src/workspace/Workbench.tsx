import { useCallback, useContext, useLayoutEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type Dispatch, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { LocaleContext, useMessages, type MessageKey } from "../i18n";
import { ContextMenu } from "../shared/ContextMenu";
import { Icon } from "../shared/Icon";
import { ScrollArea } from "../shared/ui/ScrollArea";
import { Scrollbar } from "../shared/ui/Scrollbar";
import {
  closePaneTabs, collectWorkspaceFrames, initialLayout, previewBounds, workspaceReducer, workspaceTabId,
  type LayoutAction, type PaneBounds, type PaneFrame, type PaneId, type PaneSize, type TabCloseScope,
  type WorkspaceTarget,
} from "./layout";
import { PaneSeparator } from "./PaneSeparator";
import { WorkspaceSidebar } from "./sidebar";
import { workspaceSections } from "./sidebarMenu";
import { useSidebarResize } from "./useSidebarResize";
import { useTabDrag } from "./useTabDrag";
import { workspaceViews, type WorkspaceView } from "./views";
import { WorkspaceNavigator } from "./WorkspaceNavigator";
import "./workbench.css";

const workspaceProviders = workspaceSections.flatMap(({ Provider }) => Provider ? [Provider] : []);

const tabCloseActions: ReadonlyArray<{ scope: TabCloseScope; label: MessageKey }> = [
  { scope: "current", label: "closeTab" },
  { scope: "right", label: "closeTabsToRight" },
  { scope: "left", label: "closeTabsToLeft" },
  { scope: "others", label: "closeOtherTabs" },
  { scope: "all", label: "closeAllTabs" },
];

interface TabMenuAnchor {
  pane: PaneId;
  view: string;
  x: number;
  y: number;
}

function position(bounds: PaneBounds, size: PaneSize) {
  return {
    "--pane-x": `${bounds.x}px`,
    "--pane-y": `${bounds.y}px`,
    "--pane-width": `${bounds.width}px`,
    "--pane-height": `${bounds.height}px`,
    "--pane-inline-divider-width": bounds.x + bounds.width < size.width - 0.5 ? "1px" : "0px",
    "--pane-block-divider-width": bounds.y + bounds.height < size.height - 0.5 ? "1px" : "0px",
  } as CSSProperties;
}

function tabLabel(view: string) {
  return document.getElementById(`workbench-tab-${view}`);
}

function revealTabInStrip(strip: HTMLElement, tab: HTMLElement) {
  const start = tab.offsetLeft;
  const end = start + tab.offsetWidth;
  if (start < strip.scrollLeft || tab.offsetWidth > strip.clientWidth) {
    strip.scrollLeft = start;
  } else if (end > strip.scrollLeft + strip.clientWidth) {
    strip.scrollLeft = end - strip.clientWidth;
  }
}

function revealTab(view: string) {
  const tab = tabLabel(view)?.closest<HTMLElement>(".workbench-tab");
  const strip = tab?.closest<HTMLElement>(".pane-tabs");
  if (tab && strip) revealTabInStrip(strip, tab);
}

function tabDetails(view: WorkspaceView, target: WorkspaceTarget, messages: ReturnType<typeof useMessages>,
  locale: "en" | "zh-CN") {
  const variant = view.singleton ? undefined : Object.values(view.variants ?? {}).find(({ params }) =>
    workspaceTabId({ id: view.id, params }) === workspaceTabId(target));
  const title = target.label?.[locale] ?? target.label?.en ?? target.label?.["zh-CN"]
    ?? messages[variant?.title ?? view.title];
  return { title, icon: variant?.icon ?? view.icon };
}

// Keep the mounted page and its scrollport together when moving between pane elements.
function PanePanelHost({ pane, children }: { pane: PaneId; children: ReactNode }) {
  const [host] = useState(() => {
    const element = document.createElement("div");
    element.className = "workbench-panel-host";
    return element;
  });
  useLayoutEffect(() => {
    const parent = document.getElementById(`workbench-${pane}`);
    if (parent && host.parentNode !== parent) {
      if (host.isConnected && "moveBefore" in parent && typeof parent.moveBefore === "function") parent.moveBefore(host, null);
      else parent.appendChild(host);
    }
  }, [host, pane]);
  useLayoutEffect(() => () => host.remove(), [host]);
  return createPortal(children, host);
}

function PaneToolbar({ frame, focused, number, targets, dispatch, drag, onOpenTabMenu }: {
  frame: PaneFrame;
  focused: boolean;
  number: number;
  targets: ReadonlyMap<string, WorkspaceTarget>;
  dispatch: Dispatch<LayoutAction>;
  drag: ReturnType<typeof useTabDrag>;
  onOpenTabMenu: (anchor: TabMenuAnchor) => void;
}) {
  const messages = useMessages();
  const locale = useContext(LocaleContext);
  const { pane: group } = frame;
  const pane = group.id;
  const list = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const listId = `workbench-tabs-${pane}`;
  const label = messages.editorPane.replace("{number}", String(number));
  const tabOffsets = useRef(new Map<string, number>());
  const destination = drag.destination?.type === "place" &&
    drag.destination.placement.pane === pane ? drag.destination.placement : null;

  useLayoutEffect(() => {
    const strip = list.current;
    const tab = tabLabel(group.active)?.closest<HTMLElement>(".workbench-tab");
    if (!strip || !tab) return;

    revealTabInStrip(strip, tab);
    const panes = strip.closest<HTMLElement>("[data-tab-dragging]");

    const isVisible = (width: number) => {
      const left = strip.scrollLeft;
      const start = tab.offsetLeft;
      return start >= left - 1 && start + tab.offsetWidth <= left + width + 1;
    };

    let width = strip.clientWidth;
    let wasVisible = isVisible(width);

    const onScroll = () => {
      // A scroll event from layout can arrive before the resize notification.
      if (strip.clientWidth === width) wasVisible = isVisible(width);
    };

    const observer = new ResizeObserver(() => {
      const nextWidth = strip.clientWidth;
      if (nextWidth === width) return;
      if (nextWidth < width && wasVisible && panes?.dataset.tabDragging !== "true") {
        revealTabInStrip(strip, tab);
      }
      width = nextWidth;
      wasVisible = isVisible(width);
    });

    strip.addEventListener("scroll", onScroll, { passive: true });
    observer.observe(strip);
    return () => {
      strip.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [group.active, messages]);

  useLayoutEffect(() => {
    const next = new Map<string, number>();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const tab of row.current?.querySelectorAll<HTMLElement>("[data-tab-view]") ?? []) {
      const id = tab.dataset.tabView!;
      const previous = tabOffsets.current.get(id);
      next.set(id, tab.offsetLeft);
      if (!reduceMotion && previous !== undefined && previous !== tab.offsetLeft) {
        tab.animate(
          [{ transform: `translateX(${previous - tab.offsetLeft}px)` }, { transform: "none" }],
          { duration: 150, easing: "ease-out" },
        );
      }
    }
    tabOffsets.current = next;
  }, [group.tabs]);

  function closeTab(view: string) {
    const tab = tabLabel(view)?.parentElement;
    if (group.active === view || tab?.contains(document.activeElement)) {
      const next = closePaneTabs(group, view)?.active;
      if (next !== undefined) tabLabel(next)?.focus({ preventScroll: true });
    }

    dispatch({ type: "close", pane, view });
  }

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      const { left, bottom } = event.currentTarget.getBoundingClientRect();
      onOpenTabMenu({ pane, view: group.tabs[index], x: left, y: bottom });
      return;
    }

    if (event.key === "Delete") {
      event.preventDefault();
      closeTab(group.tabs[index]);
      return;
    }

    const last = group.tabs.length - 1;
    let next: number;
    switch (event.key) {
      case "ArrowLeft": next = index === 0 ? last : index - 1; break;
      case "ArrowRight": next = index === last ? 0 : index + 1; break;
      case "Home": next = 0; break;
      case "End": next = last; break;
      default: return;
    }
    event.preventDefault();
    const view = group.tabs[next];
    dispatch({ type: "select", pane, view });
    tabLabel(view)?.focus({ preventScroll: true });
    revealTab(view);
  }

  return (
    <div className="pane-toolbar scrollbar-host" data-tablist-pane={pane} data-focused={focused}
      onPointerDown={() => dispatch({ type: "focus", pane })}
      onFocusCapture={() => dispatch({ type: "focus", pane })}>
      <div ref={list} id={listId} className="pane-tabs" role="tablist" data-tab-scrollport
        data-drop-end={destination?.anchor === null} aria-label={label}>
        <div ref={row} className="pane-tab-row" role="presentation">
          {group.tabs.map((id, index) => {
            const target = targets.get(id);
            const view = target && workspaceViews.get(target.id);
            if (!target || !view) return null;
            const { title, icon } = tabDetails(view, target, messages, locale);
            const closeLabel = messages.closeView.replace("{title}", () => title);
            const selected = group.active === id;
            const dropEdge = destination?.anchor === id && drag.draggedView !== id
              ? destination.after ? "after" : "before"
              : undefined;
            return (
              <div key={id} className="workbench-tab" role="presentation" data-selected={selected}
                data-tab-view={id} data-dragged={drag.draggedView === id} data-drop-edge={dropEdge}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (drag.draggedView !== undefined) return;
                  onOpenTabMenu({ pane, view: id, x: event.clientX, y: event.clientY });
                }}
                onMouseDown={(event) => {
                  if (event.button === 1) event.preventDefault();
                }}
                onAuxClick={(event) => {
                  if (event.button !== 1) return;
                  event.preventDefault();
                  closeTab(id);
                }}>
                <button type="button" className="workbench-tab__label" role="tab" id={`workbench-tab-${id}`}
                  title={title} aria-label={title}
                  aria-haspopup="menu"
                  aria-controls={`workbench-panel-${id}`} aria-selected={selected} tabIndex={selected ? 0 : -1}
                  onClick={() => dispatch({ type: "select", pane, view: id })}
                  onPointerDown={(event) => drag.start(event, pane, id)}
                  onKeyDown={(event) => handleTabKey(event, index)}>
                  <Icon name={icon} size={14} />
                  <span className="workbench-tab__title">{title}</span>
                </button>
                <button type="button" className="workbench-tab__close"
                  title={closeLabel} aria-label={closeLabel}
                  tabIndex={selected ? 0 : -1}
                  onMouseDown={(event) => {
                    if (event.button === 0) event.preventDefault();
                  }}
                  onClick={() => closeTab(id)}><Icon name="close" size={14} /></button>
              </div>
            );
          })}
        </div>
      </div>
      <Scrollbar viewport={list} content={row} controls={listId} className="pane-tab-scrollbar"
        orientation="horizontal" wheelOnParent
        label={messages.scrollEditorTabs.replace("{pane}", label)} />
    </div>
  );
}

export function Workbench() {
  const messages = useMessages();
  const locale = useContext(LocaleContext);
  const [layout, dispatch] = useReducer(workspaceReducer, initialLayout);
  const [sidebarSection, setSidebarSection] = useState<string | undefined>(workspaceSections[0]?.id);
  const [tabMenu, setTabMenu] = useState<TabMenuAnchor | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<PaneSize>({ width: 0, height: 0 });
  const hasPanes = layout.root !== null;
  const movedTabToFocus = useRef<string>(undefined);

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
  }, [hasPanes]);

  useLayoutEffect(() => {
    const view = movedTabToFocus.current;
    if (!view) return;
    movedTabToFocus.current = undefined;
    tabLabel(view)?.focus({ preventScroll: true });
  }, [layout.root]);

  function dispatchDrag(action: LayoutAction) {
    if ((action.type === "split" || (action.type === "place" && action.from !== action.destination.pane)) &&
      document.activeElement === tabLabel(action.view)) movedTabToFocus.current = action.view;
    dispatch(action);
  }

  const { panes: frames, splits } = useMemo(() => collectWorkspaceFrames(layout.root, size), [layout.root, size]);
  const frameByPane = useMemo(() => new Map(frames.map((frame) => [frame.pane.id, frame])), [frames]);
  const frameByView = useMemo(() => new Map(frames.flatMap((frame) =>
    frame.pane.tabs.map((id) => [id, frame] as const))), [frames]);
  const focusedPane = layout.focused ? frameByPane.get(layout.focused)?.pane : undefined;
  const activeTarget = focusedPane && layout.targets.get(focusedPane.active);
  const previewSplit = useCallback((action: Extract<LayoutAction, { type: "split" }>, bounds: PaneBounds) =>
    previewBounds(layout, action, size, bounds), [layout, size]);
  const drag = useTabDrag(dispatchDrag, frameByPane, previewSplit);
  const destination = drag.destination;
  const dockPreview = destination?.type === "split" ? destination.bounds
    : destination?.type === "content" ? frameByPane.get(destination.pane)?.bounds : undefined;
  const sidebar = useContext(WorkspaceSidebar);
  const sidebarResize = useSidebarResize(sidebar.visible);
  const tabMenuPane = tabMenu ? frameByPane.get(tabMenu.pane)?.pane : undefined;

  function openSidebar(id: string) {
    setSidebarSection(id);
    sidebar.show();
  }

  function revealTarget(target: WorkspaceTarget) {
    const view = workspaceViews.get(target.id);
    if (!view) return;
    const id = workspaceTabId(target, view.singleton);
    revealTab(id);
    dispatch({ type: "select", view: id });
  }

  function openTarget(target: WorkspaceTarget) {
    const view = workspaceViews.get(target.id);
    if (!view) return;
    const id = workspaceTabId(target, view.singleton);
    revealTab(id);
    dispatch({ type: "open", view: id, target });
  }

  function dismissTabMenu(restoreFocus: boolean) {
    if (restoreFocus && tabMenu) tabLabel(tabMenu.view)?.focus({ preventScroll: true });
    setTabMenu(null);
  }

  function closeFromTabMenu(scope: TabCloseScope) {
    if (!tabMenu || !tabMenuPane) return;
    const next = closePaneTabs(tabMenuPane, tabMenu.view, scope);
    if (next === tabMenuPane) return;

    const fallback = frames.find(({ pane }) => pane.id !== tabMenu.pane && pane.id === layout.focused)
      ?? frames.find(({ pane }) => pane.id !== tabMenu.pane);
    const view = next?.active ?? fallback?.pane.active;
    if (view !== undefined) {
      tabLabel(view)?.focus({ preventScroll: true });
    } else {
      const rail = sidebarResize.workbench.current?.querySelector(".workspace-rail nav");
      const button = rail?.querySelector<HTMLButtonElement>("[aria-pressed=true]")
        ?? rail?.querySelector<HTMLButtonElement>("button");
      button?.focus({ preventScroll: true });
    }
    dispatch({ type: "close", pane: tabMenu.pane, view: tabMenu.view, scope });
  }

  const workbench = (
    <main ref={sidebarResize.workbench} className="workbench"
      data-sidebar-resizing={sidebarResize.resizing}
      style={{ "--sidebar-width": `${sidebar.visible ? sidebarResize.width : 0}px` } as CSSProperties}>
      <WorkspaceNavigator sectionId={sidebarSection} onSelectSection={setSidebarSection} onOpen={openTarget} />
      {sidebar.visible && (
        <div className="workbench-sidebar-resizer" role="separator" tabIndex={0}
          aria-orientation="vertical" aria-controls="workspace-sidebar" aria-label={messages.resizeSidebar}
          aria-valuemin={sidebarResize.minWidth} aria-valuemax={sidebarResize.maxWidth}
          aria-valuenow={sidebarResize.width}
          onPointerDown={sidebarResize.start} onPointerMove={sidebarResize.track}
          onPointerUp={sidebarResize.stop} onPointerCancel={sidebarResize.stop}
          onLostPointerCapture={sidebarResize.stop} onKeyDown={sidebarResize.handleKeyDown} />
      )}
      {layout.root ? (
        <div ref={canvas} className="workbench-panes"
          data-single-pane={layout.root.kind === "pane"}
          data-tab-dragging={drag.draggedView !== undefined}
          onPointerDownCapture={drag.onPointerDownCapture} onClickCapture={drag.onClickCapture}
          onPointerMove={drag.track} onPointerUp={drag.finish} onPointerCancel={drag.cancel}
          onLostPointerCapture={drag.cancel}>
          {frames.map((frame, index) => (
            <div key={frame.pane.id} id={`workbench-${frame.pane.id}`} className="workbench-pane"
              style={position(frame.bounds, size)}>
              <PaneToolbar frame={frame} number={index + 1} focused={layout.focused === frame.pane.id}
                targets={layout.targets} dispatch={dispatch} drag={drag} onOpenTabMenu={setTabMenu} />
            </div>
          ))}
          {Array.from(layout.targets, ([id, target]) => {
            const frame = frameByView.get(id);
            const view = workspaceViews.get(target.id);
            if (!frame || !view) return null;
            const { pane } = frame;
            const { Page } = view;
            return (
              <PanePanelHost key={id} pane={pane.id}>
                <ScrollArea as="section" id={`workbench-panel-${id}`} className="workbench-panel"
                  data-drop-pane={pane.id}
                  role="tabpanel" aria-labelledby={`workbench-tab-${id}`} tabIndex={0}
                  hidden={pane.active !== id} onFocusCapture={() => dispatch({ type: "focus", pane: pane.id })}
                  onPointerDown={() => dispatch({ type: "focus", pane: pane.id })}>
                  <Page {...target} title={tabDetails(view, target, messages, locale).title} open={openTarget} />
                </ScrollArea>
              </PanePanelHost>
            );
          })}
          {splits.map((split) => (
            <PaneSeparator key={`${split.id}:${split.primaryPane}`} frame={split} controls={`workbench-tabs-${split.primaryPane}`}
              onResize={(ratio) => dispatch({ type: "resize", frame: split, ratio })} />
          ))}
          {dockPreview && (
            <div className="workbench-dock-preview" style={position(dockPreview, size)}
              aria-hidden="true" />
          )}
        </div>
      ) : (
        <div className="workbench-empty-mark" aria-hidden="true" />
      )}
      {tabMenu && tabMenuPane?.tabs.includes(tabMenu.view) && (
        <ContextMenu key={`${tabMenu.pane}:${tabMenu.view}`} x={tabMenu.x} y={tabMenu.y}
          label={messages.tabActions} onDismiss={dismissTabMenu}
          items={tabCloseActions.map(({ scope, label }) => ({
            id: scope,
            label: messages[label],
            enabled: closePaneTabs(tabMenuPane, tabMenu.view, scope) !== tabMenuPane,
            onSelect: () => closeFromTabMenu(scope),
          }))} />
      )}
    </main>
  );

  return workspaceProviders.reduceRight<ReactNode>((children, Provider) => (
    <Provider activeTarget={activeTarget} openSidebar={openSidebar} revealTarget={revealTarget}>{children}</Provider>
  ), workbench);
}
