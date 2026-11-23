import { useLayoutEffect, useRef, useState, type Dispatch, type MouseEvent, type PointerEvent } from "react";
import type { LayoutAction, PaneFrame, PaneId, SplitEdge, TabDestination } from "./layout";

type DragDestination =
  | { type: "place"; placement: TabDestination; region: "tabs" | "content" }
  | { type: "split"; pane: PaneId; edge: SplitEdge };

interface DragPoint {
  clientX: number;
  clientY: number;
}

interface DropHit {
  target: Element;
  region: HTMLElement;
}

interface DragSession {
  pointerId: number;
  from: PaneId;
  view: string;
  origin: DragPoint;
  point: DragPoint;
  dragging: boolean;
}

function hitAt(container: HTMLElement, { clientX, clientY }: DragPoint): DropHit | null {
  const target = document.elementFromPoint(clientX, clientY);
  const region = target?.closest<HTMLElement>("[data-tablist-pane], [data-drop-pane]");
  return target && region && container.contains(region) ? { target, region } : null;
}

function edgeScrollAt(hit: DropHit | null, { clientX, clientY }: DragPoint) {
  if (!hit?.region.dataset.tablistPane) return null;
  const viewport = hit.region.querySelector<HTMLElement>("[data-tab-scrollport]");
  if (!viewport) return null;

  const limit = viewport.scrollWidth - viewport.clientWidth;
  if (limit <= 0) return null;

  const bounds = viewport.getBoundingClientRect();
  if (clientY < bounds.top || clientY >= bounds.bottom) return null;
  const left = clientX - bounds.left;
  const right = bounds.right - clientX;
  const distance = Math.min(left, right);
  // Keep a neutral middle area even in a narrow split pane.
  const edgeWidth = Math.min(40, bounds.width / 4);
  if (distance < 0 || distance >= edgeWidth) return null;

  const direction = left < right ? -1 : 1;
  if (direction < 0 ? viewport.scrollLeft <= 0 : viewport.scrollLeft >= limit) return null;

  return { viewport, direction, speed: 160 + 560 * (1 - distance / edgeWidth) };
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
  hit: DropHit | null,
  { clientX, clientY }: DragPoint,
  drag: DragSession,
  frames: Map<PaneId, PaneFrame>,
): DragDestination | null {
  if (!hit) return null;

  const { target, region } = hit;
  const pane = (region.dataset.tablistPane ?? region.dataset.dropPane) as PaneId;
  const frame = frames.get(pane);
  if (!frame) return null;
  if (region.dataset.tablistPane) {
    const tab = target.closest<HTMLElement>("[data-tab-view]");
    const bounds = tab?.getBoundingClientRect();
    return {
      type: "place",
      region: "tabs",
      placement: {
        pane,
        anchor: tab?.dataset.tabView ?? null,
        after: bounds ? clientX >= bounds.left + bounds.width / 2 : false,
      },
    };
  }

  if (pane !== drag.from || frame.pane.tabs.length > 1) {
    const edge = nearestEdge(region.getBoundingClientRect(), clientX, clientY);
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
  const scrollFrame = useRef<number | null>(null);
  const currentFrames = useRef(frames);
  const suppressClick = useRef(false);
  const [draggedView, setDraggedView] = useState<string>();
  const [destination, setDestination] = useState<DragDestination | null>(null);

  useLayoutEffect(() => {
    currentFrames.current = frames;
    const drag = session.current;
    if (drag && !frames.get(drag.from)?.pane.tabs.includes(drag.view)) clear();
  }, [frames]);

  useLayoutEffect(() => {
    function handleBlur() {
      if (session.current) clear();
    }

    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("blur", handleBlur);
      stopScrolling();
    };
  }, []);

  function stopScrolling() {
    if (scrollFrame.current === null) return;
    cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = null;
  }

  function updateDestination(hit: DropHit | null, drag: DragSession) {
    const next = destinationAt(hit, drag.point, drag, currentFrames.current);
    setDestination((previous) => sameDestination(previous, next) ? previous : next);
  }

  function scheduleScroll(container: HTMLElement, previousTime = performance.now()) {
    if (scrollFrame.current !== null) return;

    scrollFrame.current = requestAnimationFrame((time) => {
      scrollFrame.current = null;
      const drag = session.current;
      if (!drag?.dragging) return;

      const hit = hitAt(container, drag.point);
      const edge = edgeScrollAt(hit, drag.point);
      if (!edge) {
        updateDestination(hit, drag);
        return;
      }

      const { viewport, direction, speed } = edge;
      const previousOffset = viewport.scrollLeft;
      // Bound long frames and keep the step above the scroll offset's pixel rounding.
      const step = Math.max(1, Math.round(speed * Math.min(time - previousTime, 32) / 1000));
      viewport.scrollLeft += direction * step;
      updateDestination(hitAt(container, drag.point), drag);
      if (viewport.scrollLeft !== previousOffset) scheduleScroll(container, time);
    });
  }

  function start(event: PointerEvent<HTMLButtonElement>, from: PaneId, view: string) {
    if (event.button !== 0 || !event.isPrimary || session.current) return;
    const point = { clientX: event.clientX, clientY: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    session.current = {
      pointerId: event.pointerId,
      from,
      view,
      origin: point,
      point,
      dragging: false,
    };
  }

  function track(event: PointerEvent<HTMLElement>) {
    const drag = session.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = { clientX: event.clientX, clientY: event.clientY };
    if (!drag.dragging) {
      if (Math.hypot(point.clientX - drag.origin.clientX, point.clientY - drag.origin.clientY) < 5) return;
      drag.dragging = true;
      setDraggedView(drag.view);
    }

    drag.point = point;
    const hit = hitAt(event.currentTarget, point);
    updateDestination(hit, drag);
    if (edgeScrollAt(hit, point)) scheduleScroll(event.currentTarget);
    else stopScrolling();
  }

  function clear() {
    stopScrolling();
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
    const target = destinationAt(hitAt(event.currentTarget, event), event, drag, frames);
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
