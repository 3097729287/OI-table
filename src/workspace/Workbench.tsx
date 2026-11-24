import { useContext, useLayoutEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type Dispatch, type KeyboardEvent } from "react";
import { useMessages, type MessageKey } from "../i18n";
import { ContextMenu } from "../shared/ContextMenu";
import { Icon } from "../shared/Icon";
import emptyWorkbenchImage from "./assets/oi-table-product.svg?no-inline";
import { closePaneTabs, collectPaneFrames, initialLayout, previewBounds, workspaceReducer, type LayoutAction, type PaneBounds, type PaneFrame, type PaneId, type TabCloseScope } from "./layout";
import { WorkspaceSidebar } from "./sidebar";
import { TabScrollbar } from "./TabScrollbar";
import { useSidebarResize } from "./useSidebarResize";
import { useTabDrag } from "./useTabDrag";
import { workspaceViews } from "./views";
import { WorkspaceNavigator } from "./WorkspaceNavigator";
import "./workbench.css";

const viewsById = new Map(workspaceViews.map((view) => [view.id, view]));
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

function position(bounds: PaneBounds) {
  return {
    "--pane-x": `${bounds.x}%`,
    "--pane-y": `${bounds.y}%`,
    "--pane-width": `${bounds.width}%`,
    "--pane-height": `${bounds.height}%`,
    "--pane-inline-divider-width": bounds.x + bounds.width < 100 ? "1px" : "0px",
    "--pane-block-divider-width": bounds.y + bounds.height < 100 ? "1px" : "0px",
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

function PaneToolbar({ frame, focused, number, dispatch, drag, onOpenTabMenu }: {
  frame: PaneFrame;
  focused: boolean;
  number: number;
  dispatch: Dispatch<LayoutAction>;
  drag: ReturnType<typeof useTabDrag>;
  onOpenTabMenu: (anchor: TabMenuAnchor) => void;
}) {
  const messages = useMessages();
  const { pane: group, bounds } = frame;
  const pane = group.id;
  const list = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const listId = `workbench-tabs-${pane}`;
  const label = messages.editorPane.replace("{number}", String(number));
  const tabOffsets = useRef(new Map<string, number>());
  const destination = drag.destination?.type === "place" && drag.destination.region === "tabs" &&
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
    <div className="pane-toolbar" data-tablist-pane={pane} data-focused={focused} style={position(bounds)}
      onPointerDown={() => dispatch({ type: "focus", pane })}
      onFocusCapture={() => dispatch({ type: "focus", pane })}>
      <div ref={list} id={listId} className="pane-tabs" role="tablist" data-tab-scrollport
        data-drop-end={destination?.anchor === null} aria-label={label}>
        <div ref={row} className="pane-tab-row" role="presentation">
          {group.tabs.map((id, index) => {
            const view = viewsById.get(id);
            if (!view) return null;
            const title = messages[view.title];
            const closeLabel = messages.closeView.replace("{title}", title);
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
                  <Icon name={view.icon} size={14} />
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
      <TabScrollbar viewport={list} content={row} controls={listId}
        label={messages.scrollEditorTabs.replace("{pane}", label)} />
    </div>
  );
}

export function Workbench() {
  const messages = useMessages();
  const [layout, dispatch] = useReducer(workspaceReducer, initialLayout);
  const [tabMenu, setTabMenu] = useState<TabMenuAnchor | null>(null);
  const frames = useMemo(() => collectPaneFrames(layout.root), [layout.root]);
  const frameByPane = useMemo(() => new Map(frames.map((frame) => [frame.pane.id, frame])), [frames]);
  const frameByView = useMemo(() => new Map(frames.flatMap((frame) =>
    frame.pane.tabs.map((id) => [id, frame] as const))), [frames]);
  const drag = useTabDrag(dispatch, frameByPane);
  const contentDropPane = drag.destination?.type === "place" && drag.destination.region === "content"
    ? drag.destination.placement.pane
    : undefined;
  const splitTarget = drag.destination?.type === "split" ? drag.destination : undefined;
  const splitFrame = splitTarget ? frameByPane.get(splitTarget.pane) : undefined;
  const sidebar = useContext(WorkspaceSidebar);
  const sidebarResize = useSidebarResize(sidebar.visible);
  const tabMenuPane = tabMenu ? frameByPane.get(tabMenu.pane)?.pane : undefined;

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

  return (
    <main ref={sidebarResize.workbench} className="workbench"
      data-sidebar-resizing={sidebarResize.resizing}
      style={{ "--sidebar-width": `${sidebar.visible ? sidebarResize.width : 0}px` } as CSSProperties}>
      <WorkspaceNavigator onOpen={(view) => {
        revealTab(view);
        dispatch({ type: "open", view });
      }} />
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
        <div className="workbench-panes"
          data-tab-dragging={drag.draggedView !== undefined}
          onPointerDownCapture={drag.onPointerDownCapture} onClickCapture={drag.onClickCapture}
          onPointerMove={drag.track} onPointerUp={drag.finish} onPointerCancel={drag.cancel}
          onLostPointerCapture={drag.cancel}>
          {frames.map((frame, index) => (
            <PaneToolbar key={frame.pane.id} frame={frame} number={index + 1}
              focused={layout.focused === frame.pane.id} dispatch={dispatch} drag={drag}
              onOpenTabMenu={setTabMenu} />
          ))}
          {/* Keep panels keyed by view when their pane changes so drafts and scroll state survive. */}
          {workspaceViews.map(({ id, title, Page }) => {
            const frame = frameByView.get(id);
            if (!frame) return null;
            const { pane, bounds } = frame;
            return (
              <section key={id} id={`workbench-panel-${id}`} className="workbench-panel" style={position(bounds)}
                data-drop-pane={pane.id} data-drop-target={contentDropPane === pane.id}
                role="tabpanel" aria-labelledby={`workbench-tab-${id}`} tabIndex={0}
                hidden={pane.active !== id} onFocusCapture={() => dispatch({ type: "focus", pane: pane.id })}
                onPointerDown={() => dispatch({ type: "focus", pane: pane.id })}>
                <Page title={messages[title]} />
              </section>
            );
          })}
          {splitTarget && splitFrame && (
            <div className="workbench-dock-preview" style={position(previewBounds(splitFrame.bounds, splitTarget.edge))}
              aria-hidden="true" />
          )}
        </div>
      ) : (
        <img className="workbench-empty-image" src={emptyWorkbenchImage} alt="" draggable={false} />
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
}
