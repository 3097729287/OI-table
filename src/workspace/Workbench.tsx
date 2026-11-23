import { useContext, useLayoutEffect, useMemo, useReducer, useRef, type CSSProperties, type Dispatch, type KeyboardEvent } from "react";
import { messages } from "../i18n";
import { Icon } from "../shared/Icon";
import emptyWorkbenchImage from "./assets/oi-table-product.svg?no-inline";
import { collectPaneFrames, initialLayout, nextTabAfterClose, previewBounds, workspaceReducer, type LayoutAction, type PaneBounds, type PaneFrame, type PaneId } from "./layout";
import { WorkspaceSidebar } from "./sidebar";
import { TabScrollbar } from "./TabScrollbar";
import { useSidebarResize } from "./useSidebarResize";
import { useTabDrag } from "./useTabDrag";
import { workspaceViews } from "./views";
import { WorkspaceNavigator } from "./WorkspaceNavigator";
import "./workbench.css";

const viewsById = new Map(workspaceViews.map((view) => [view.id, view]));

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

function revealTab(view: string) {
  const tab = tabLabel(view)?.closest<HTMLElement>(".workbench-tab");
  const strip = tab?.closest<HTMLElement>(".pane-tabs");
  if (!tab || !strip) return;

  const start = tab.offsetLeft;
  const end = start + tab.offsetWidth;
  if (start < strip.scrollLeft || tab.offsetWidth > strip.clientWidth) {
    strip.scrollLeft = start;
  } else if (end > strip.scrollLeft + strip.clientWidth) {
    strip.scrollLeft = end - strip.clientWidth;
  }
}

function PaneToolbar({ frame, focused, number, dispatch, drag }: {
  frame: PaneFrame;
  focused: boolean;
  number: number;
  dispatch: Dispatch<LayoutAction>;
  drag: ReturnType<typeof useTabDrag>;
}) {
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
    revealTab(group.active);
  }, [group.active]);

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
      const next = nextTabAfterClose(group, view);
      if (next !== undefined) tabLabel(next)?.focus({ preventScroll: true });
    }

    dispatch({ type: "close", pane, view });
  }

  function handleTabKey(event: KeyboardEvent, index: number) {
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
      <div ref={list} id={listId} className="pane-tabs" role="tablist"
        data-drop-end={destination?.anchor === null} aria-label={label}>
        <div ref={row} className="pane-tab-row" role="presentation">
          {group.tabs.map((id, index) => {
            const view = viewsById.get(id);
            if (!view) return null;
            const selected = group.active === id;
            const dropEdge = destination?.anchor === id && drag.draggedView !== id
              ? destination.after ? "after" : "before"
              : undefined;
            return (
              <div key={id} className="workbench-tab" role="presentation" data-selected={selected}
                data-tab-view={id} data-dragged={drag.draggedView === id} data-drop-edge={dropEdge}
                onMouseDown={(event) => {
                  if (event.button === 1) event.preventDefault();
                }}
                onAuxClick={(event) => {
                  if (event.button !== 1) return;
                  event.preventDefault();
                  closeTab(id);
                }}>
                <button type="button" className="workbench-tab__label" role="tab" id={`workbench-tab-${id}`}
                  title={view.title} aria-label={view.title}
                  aria-controls={`workbench-panel-${id}`} aria-selected={selected} tabIndex={selected ? 0 : -1}
                  onClick={() => dispatch({ type: "select", pane, view: id })}
                  onPointerDown={(event) => drag.start(event, pane, id)}
                  onKeyDown={(event) => handleTabKey(event, index)}>
                  <Icon name={view.icon} size={14} />
                  <span className="workbench-tab__title">{view.title}</span>
                </button>
                <button type="button" className="workbench-tab__close"
                  title={messages.closeView.replace("{title}", view.title)}
                  aria-label={messages.closeView.replace("{title}", view.title)}
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
  const [layout, dispatch] = useReducer(workspaceReducer, initialLayout);
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
              focused={layout.focused === frame.pane.id} dispatch={dispatch} drag={drag} />
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
                <Page title={title} />
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
    </main>
  );
}
