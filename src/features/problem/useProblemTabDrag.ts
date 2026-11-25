import { useLayoutEffect, useRef, useState, type PointerEvent, type MouseEvent } from "react";
import type { LayoutAction, PaneBounds, PaneFrame, PaneId } from "../../workspace/layout";

type SplitAction = Extract<LayoutAction, { type: "split" }>;
type PlaceAction = Extract<LayoutAction, { type: "place" }>;
type Drop = { action: SplitAction; bounds: PaneBounds } | { action: PlaceAction; intoBody: boolean };

interface Point {
  clientX: number;
  clientY: number;
}

interface Session {
  from: PaneId;
  id: string;
  pointerId: number;
  x: number;
  y: number;
  moved: boolean;
  latest?: Point & { container: HTMLDivElement };
}

function hitAt(container: HTMLDivElement, { clientX, clientY }: Point) {
  const hit = container.ownerDocument.elementFromPoint(clientX, clientY);
  const region = hit?.closest<HTMLElement>("[data-problem-tablist], [data-problem-drop-body]");
  return hit && region?.closest("[data-problem-workspace]") === container ? { hit, region } : undefined;
}

export function useProblemTabDrag(frames: ReadonlyMap<PaneId, PaneFrame>,
  previewSplit: (action: SplitAction) => PaneBounds | undefined,
  onDrop: (action: SplitAction | PlaceAction) => void) {
  const session = useRef<Session>(undefined);
  const suppressClick = useRef(false);
  const [dragged, setDragged] = useState<string>();
  const [drop, setDrop] = useState<Drop>();

  function clear() {
    session.current = undefined;
    setDragged(undefined);
    setDrop(undefined);
  }

  useLayoutEffect(() => {
    const active = session.current;
    if (active && !frames.get(active.from)?.pane.tabs.includes(active.id)) clear();
    else if (active?.latest) setDrop(locate(active.latest.container, active.latest, active));
  }, [frames]);

  useLayoutEffect(() => {
    window.addEventListener("blur", clear);
    return () => window.removeEventListener("blur", clear);
  }, []);

  useLayoutEffect(() => {
    if (!dragged) return;

    let frame: number;
    function scrollNearEdge() {
      const active = session.current;
      const point = active?.latest;
      if (!active || !point) return;
      const strip = hitAt(point.container, point)?.region;
      if (strip?.dataset.problemTablist && strip.scrollWidth > strip.clientWidth) {
        const bounds = strip.getBoundingClientRect();
        const left = point.clientX - bounds.left;
        const right = bounds.right - point.clientX;
        const edge = Math.min(32, bounds.width / 4);
        if (Math.min(left, right) < edge) {
          const previous = strip.scrollLeft;
          strip.scrollLeft += left < right ? -9 : 9;
          if (previous !== strip.scrollLeft) setDrop(locate(point.container, point, active));
        }
      }
      frame = requestAnimationFrame(scrollNearEdge);
    }

    frame = requestAnimationFrame(scrollNearEdge);
    return () => cancelAnimationFrame(frame);
  }, [dragged, frames]);

  function locate(container: HTMLDivElement, point: Point, active: Session): Drop | undefined {
    const target = hitAt(container, point);
    if (!target) return;
    const { hit, region } = target;

    const pane = (region.dataset.problemTablist ?? region.dataset.problemDropBody) as PaneId;
    const frame = frames.get(pane);
    if (!frame) return;

    const place: PlaceAction = { type: "place", from: active.from, view: active.id,
      destination: { pane, anchor: null, after: false } };
    if (region.dataset.problemTablist) {
      const tab = hit.closest<HTMLElement>("[data-problem-tab]");
      if (tab) {
        const rect = tab.getBoundingClientRect();
        place.destination.anchor = tab.dataset.problemTab ?? null;
        place.destination.after = point.clientX >= rect.left + rect.width / 2;
      }
      return { action: place, intoBody: false };
    }

    if (active.from !== pane || frame.pane.tabs.length > 1) {
      const bounds = region.getBoundingClientRect();
      const x = (point.clientX - bounds.left) / bounds.width;
      const y = (point.clientY - bounds.top) / bounds.height;
      const distances = { left: x, right: 1 - x, top: y, bottom: 1 - y };
      let nearest = 0.24;
      let split: Drop | undefined;
      for (const edge of ["left", "right", "top", "bottom"] as const) {
        if (distances[edge] >= nearest) continue;
        const action: SplitAction = { type: "split", from: active.from, target: pane, view: active.id, edge };
        const preview = previewSplit(action);
        if (!preview) continue;
        nearest = distances[edge];
        split = { action, bounds: preview };
      }
      if (split) return split;
    }

    return active.from === pane ? undefined : { action: place, intoBody: true };
  }

  function start(event: PointerEvent<HTMLButtonElement>, from: PaneId, id: string) {
    if (event.button !== 0 || !event.isPrimary || session.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    session.current = { from, id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  }

  function track(event: PointerEvent<HTMLDivElement>) {
    const active = session.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (!active.moved && Math.hypot(event.clientX - active.x, event.clientY - active.y) < 5) return;
    if (!active.moved) {
      active.moved = true;
      setDragged(active.id);
    }
    active.latest = { container: event.currentTarget, clientX: event.clientX, clientY: event.clientY };
    setDrop(locate(event.currentTarget, event, active));
  }

  function finish(event: PointerEvent<HTMLDivElement>) {
    const active = session.current;
    if (!active || active.pointerId !== event.pointerId) return;
    clear();
    if (!active.moved) return;
    suppressClick.current = true;
    const destination = locate(event.currentTarget, event, active);
    if (destination) onDrop(destination.action);
  }

  function cancel(event: PointerEvent<HTMLDivElement>) {
    if (session.current?.pointerId === event.pointerId) clear();
  }

  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (!suppressClick.current || event.detail === 0) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  return { start, track, finish, cancel, drop, dragged, onClickCapture,
    onPointerDownCapture: () => { suppressClick.current = false; } };
}
