import { useRef, useState, type Dispatch, type MouseEvent, type PointerEvent } from "react";
import type { LayoutAction, PaneFrame, PaneId, SplitEdge, TabDestination } from "./layout";

type DragDestination =
  | { type: "place"; placement: TabDestination; region: "tabs" | "content" }
  | { type: "split"; pane: PaneId; edge: SplitEdge };

interface DragSession {
  pointerId: number;
  from: PaneId;
  view: string;
  x: number;
  y: number;
  dragging: boolean;
}

function nearestEdge(bounds: DOMRect, x: number, y: number): SplitEdge | undefined {
  const horizontal = (x - bounds.left) / bounds.width;
  const vertical = (y - bounds.top) / bounds.height;
  const distances = { left: horizontal, right: 1 - horizontal, top: vertical, bottom: 1 - vertical };
  let closest: SplitEdge | undefined;
  let threshold = 0.24;
  for (const edge of ["left", "right", "top", "bottom"] as const) {
    const horizontalSplit = edge === "left" || edge === "right";
    if (horizontalSplit ? bounds.width < 256 : bounds.height < 180) continue;
    if (distances[edge] < threshold) {
      threshold = distances[edge];
      closest = edge;
    }
  }
  return closest;
}

function destinationAt(
  event: PointerEvent<HTMLElement>,
  drag: DragSession,
  frames: Map<PaneId, PaneFrame>,
): DragDestination | null {
  const target = document.elementFromPoint(event.clientX, event.clientY);
  const region = target?.closest<HTMLElement>("[data-tablist-pane], [data-drop-pane]");
  if (!region || !event.currentTarget.contains(region)) return null;

  const pane = (region.dataset.tablistPane ?? region.dataset.dropPane) as PaneId;
  const frame = frames.get(pane);
  if (!frame) return null;
  if (region.dataset.tablistPane) {
    const tab = target?.closest<HTMLElement>("[data-tab-view]");
    const bounds = tab?.getBoundingClientRect();
    return {
      type: "place",
      region: "tabs",
      placement: {
        pane,
        anchor: tab?.dataset.tabView ?? null,
        after: bounds ? event.clientX >= bounds.left + bounds.width / 2 : false,
      },
    };
  }

  if (pane !== drag.from || frame.pane.tabs.length > 1) {
    const edge = nearestEdge(region.getBoundingClientRect(), event.clientX, event.clientY);
    if (edge) return { type: "split", pane, edge };
  }
  return pane !== drag.from
    ? { type: "place", region: "content", placement: { pane, anchor: null, after: false } }
    : null;
}

function sameDestination(a: DragDestination | null, b: DragDestination | null) {
  if (!a || !b) return a === b;
  if (a.type === "split" && b.type === "split") return a.pane === b.pane && a.edge === b.edge;
  if (a.type !== "place" || b.type !== "place") return false;
  return a.region === b.region && a.placement.pane === b.placement.pane &&
    a.placement.anchor === b.placement.anchor && a.placement.after === b.placement.after;
}

export function useTabDrag(dispatch: Dispatch<LayoutAction>, frames: Map<PaneId, PaneFrame>) {
  const session = useRef<DragSession | null>(null);
  const suppressClick = useRef(false);
  const [draggedView, setDraggedView] = useState<string>();
  const [destination, setDestination] = useState<DragDestination | null>(null);

  function start(event: PointerEvent<HTMLButtonElement>, from: PaneId, view: string) {
    if (event.button !== 0 || !event.isPrimary || session.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    session.current = {
      pointerId: event.pointerId,
      from,
      view,
      x: event.clientX,
      y: event.clientY,
      dragging: false,
    };
  }

  function track(event: PointerEvent<HTMLElement>) {
    const drag = session.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.dragging) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
      drag.dragging = true;
      setDraggedView(drag.view);
    }

    const next = destinationAt(event, drag, frames);
    setDestination((previous) => sameDestination(previous, next) ? previous : next);
  }

  function clear() {
    session.current = null;
    setDraggedView(undefined);
    setDestination(null);
  }

  function finish(event: PointerEvent<HTMLElement>) {
    const drag = session.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    clear();
    if (!drag.dragging) return;

    suppressClick.current = true;
    const target = destinationAt(event, drag, frames);
    if (target?.type === "split") {
      dispatch({ type: "split", from: drag.from, target: target.pane, view: drag.view, edge: target.edge });
    } else if (target?.type === "place") {
      dispatch({ type: "place", from: drag.from, view: drag.view, destination: target.placement });
    }
  }

  function cancel(event: PointerEvent<HTMLElement>) {
    if (session.current?.pointerId === event.pointerId) clear();
  }

  function onClickCapture(event: MouseEvent<HTMLElement>) {
    if (!suppressClick.current || event.detail === 0) return;
    suppressClick.current = false;
    event.stopPropagation();
    event.preventDefault();
  }

  return {
    start,
    track,
    finish,
    cancel,
    destination,
    draggedView,
    onClickCapture,
    onPointerDownCapture: () => { suppressClick.current = false; },
  };
}
