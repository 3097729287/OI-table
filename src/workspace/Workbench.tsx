import { useContext, useLayoutEffect, useMemo, useReducer, useRef, type CSSProperties, type Dispatch, type KeyboardEvent } from "react";
import { messages } from "../i18n";
import { Icon } from "../shared/Icon";
import emptyWorkbenchImage from "./assets/oi-table-product.svg?no-inline";
import { collectPaneFrames, initialLayout, previewBounds, workspaceReducer, type LayoutAction, type PaneBounds, type PaneFrame, type PaneId } from "./layout";
import { WorkspaceSidebar } from "./sidebar";
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
  const tabOffsets = useRef(new Map<string, number>());
  const destination = drag.destination?.type === "place" && drag.destination.region === "tabs" &&
    drag.destination.placement.pane === pane ? drag.destination.placement : null;

  useLayoutEffect(() => {
    const next = new Map<string, number>();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const tab of list.current?.querySelectorAll<HTMLElement>("[data-tab-view]") ?? []) {
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

  function navigateTabs(event: KeyboardEvent, index: number) {
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
    document.getElementById(`workbench-tab-${view}`)?.focus();
  }

  return (
    <div className="pane-toolbar" data-focused={focused} style={position(bounds)}
      onPointerDown={() => dispatch({ type: "focus", pane })}
      onFocusCapture={() => dispatch({ type: "focus", pane })}>
      <div ref={list} className="pane-tabs" role="tablist" data-tablist-pane={pane}
        data-drop-end={destination?.anchor === null}
        aria-label={messages.editorPane.replace("{number}", String(number))}>
        {group.tabs.map((id, index) => {
          const view = viewsById.get(id);
          if (!view) return null;
          const selected = group.active === id;
          const dropEdge = destination?.anchor === id && drag.draggedView !== id
            ? destination.after ? "after" : "before"
            : undefined;
          return (
            <div key={id} className="workbench-tab" role="presentation" data-selected={selected}
              data-tab-view={id} data-dragged={drag.draggedView === id} data-drop-edge={dropEdge}>
              <button type="button" className="workbench-tab__label" role="tab" id={`workbench-tab-${id}`}
                title={view.title} aria-label={view.title}
                aria-controls={`workbench-panel-${id}`} aria-selected={selected} tabIndex={selected ? 0 : -1}
                onClick={() => dispatch({ type: "select", pane, view: id })}
                onPointerDown={(event) => drag.start(event, pane, id)}
                onKeyDown={(event) => navigateTabs(event, index)}>
                <Icon name={view.icon} />
                {view.title}
              </button>
              <button type="button" className="workbench-tab__close"
                title={messages.closeView.replace("{title}", view.title)}
                aria-label={messages.closeView.replace("{title}", view.title)}
                onClick={() => {
                  const next = selected ? group.tabs[index + 1] ?? group.tabs[index - 1] : group.active;
                  if (next) document.getElementById(`workbench-tab-${next}`)?.focus();
                  dispatch({ type: "close", pane, view: id });
                }}><Icon name="close" size={12} /></button>
            </div>
          );
        })}
      </div>
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
      <WorkspaceNavigator onOpen={(view) => dispatch({ type: "open", view })} />
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
