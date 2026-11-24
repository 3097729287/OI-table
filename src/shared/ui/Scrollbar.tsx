import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import "./scrollbar.css";

export type ScrollOrientation = "horizontal" | "vertical";

interface ScrollbarProps {
  viewport: RefObject<HTMLElement | null>;
  content?: RefObject<HTMLElement | null>;
  controls: string;
  label: string;
  orientation: ScrollOrientation;
  className?: string;
  focusable?: boolean;
  wheelOnParent?: boolean;
}

const scrollStep = 32;
const minThumbSize = 24;

export function Scrollbar({
  viewport, content, controls, label, orientation, className, focusable = true, wheelOnParent,
}: ScrollbarProps) {
  const track = useRef<HTMLDivElement>(null);
  const horizontal = orientation === "horizontal";
  const [metrics, setMetrics] = useState({ view: 0, length: 0, max: 0, offset: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointerId: number; grab: number } | null>(null);

  useLayoutEffect(() => {
    const element = viewport.current;
    const bar = track.current;
    if (!element || !bar) return;

    function measure() {
      if (!element || !bar) return;
      const view = horizontal ? element.clientWidth : element.clientHeight;
      const length = horizontal ? bar.clientWidth : bar.clientHeight;
      const max = Math.max(0, (horizontal ? element.scrollWidth : element.scrollHeight) - view);
      const offset = Math.max(0, Math.min(max, horizontal ? element.scrollLeft : element.scrollTop));
      setMetrics((previous) => previous.view === view && previous.length === length &&
        previous.max === max && previous.offset === offset ? previous : { view, length, max, offset });
    }

    function scrollWithWheel(event: WheelEvent) {
      if (!element || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
      const axis = horizontal ? "scrollLeft" : "scrollTop";
      const delta = horizontal && Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? scrollStep
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? (horizontal ? element.clientWidth : element.clientHeight) : 1;
      const before = element[axis];
      element[axis] += delta * unit;
      if (element[axis] !== before && event.cancelable) event.preventDefault();
    }

    const sizeObserver = new ResizeObserver(measure);
    sizeObserver.observe(element);
    sizeObserver.observe(bar);
    const row = content?.current;
    const contentObserver = !row ? new MutationObserver((records) => {
      for (const { addedNodes, removedNodes } of records) {
        for (const node of removedNodes) if (node instanceof Element) sizeObserver.unobserve(node);
        for (const node of addedNodes) if (node instanceof Element) sizeObserver.observe(node);
      }
      measure();
    }) : undefined;
    if (row) sizeObserver.observe(row);
    else for (const child of element.children) sizeObserver.observe(child);
    contentObserver?.observe(element, { childList: true });

    const wheelRegion = wheelOnParent ? element.parentElement : bar;
    measure();
    element.addEventListener("scroll", measure, { passive: true });
    element.addEventListener("input", measure);
    wheelRegion?.addEventListener("wheel", scrollWithWheel, { passive: false });
    return () => {
      sizeObserver.disconnect();
      contentObserver?.disconnect();
      element.removeEventListener("scroll", measure);
      element.removeEventListener("input", measure);
      wheelRegion?.removeEventListener("wheel", scrollWithWheel);
    };
  }, [viewport, content, horizontal, wheelOnParent]);

  const { view, length, max, offset } = metrics;
  const overflow = view > 0 && length > 0 && max > 0;
  const thumbSize = overflow ? Math.max(length * view / (view + max), Math.min(minThumbSize, length / 2)) : 0;
  const travel = length - thumbSize;
  const thumbOffset = overflow ? offset / max * travel : 0;

  function trackOffset(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return horizontal ? event.clientX - rect.left : event.clientY - rect.top;
  }

  function scrollTo(value: number) {
    const element = viewport.current;
    if (!element) return;
    if (horizontal) element.scrollLeft = value;
    else element.scrollTop = value;
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !event.isPrimary || !overflow) return;

    const position = trackOffset(event);
    if (focusable) event.currentTarget.focus({ preventScroll: true });
    event.preventDefault();
    if (position < thumbOffset || position > thumbOffset + thumbSize) {
      scrollTo(offset + (position < thumbOffset ? -view : view));
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, grab: position - thumbOffset };
    setDragging(true);
  }

  function moveThumb(event: PointerEvent<HTMLDivElement>) {
    const session = drag.current;
    if (session?.pointerId === event.pointerId && travel > 0 && overflow) {
      scrollTo((trackOffset(event) - session.grab) / travel * max);
    }
  }

  function stopDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
  }

  function scrollWithKey(event: KeyboardEvent<HTMLDivElement>) {
    const backward = horizontal ? "ArrowLeft" : "ArrowUp";
    const forward = horizontal ? "ArrowRight" : "ArrowDown";
    let target: number;
    switch (event.key) {
      case backward: target = offset - scrollStep; break;
      case forward: target = offset + scrollStep; break;
      case "PageUp": target = offset - view; break;
      case "PageDown": target = offset + view; break;
      case "Home": target = 0; break;
      case "End": target = max; break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    scrollTo(target);
  }

  const accessible = focusable && overflow;
  return (
    <div ref={track} className={className ? `scrollbar ${className}` : "scrollbar"}
      role={accessible ? "scrollbar" : undefined} tabIndex={accessible ? 0 : undefined}
      aria-hidden={!accessible} aria-label={accessible ? label : undefined}
      aria-controls={accessible ? controls : undefined} aria-orientation={accessible ? orientation : undefined}
      aria-valuenow={accessible ? Math.round(offset / max * 100) : undefined}
      data-orientation={orientation} data-overflow={overflow} data-dragging={dragging}
      onPointerDown={startDrag} onPointerMove={moveThumb} onPointerUp={stopDrag}
      onPointerCancel={stopDrag} onLostPointerCapture={stopDrag} onKeyDown={scrollWithKey}>
      <span className="scrollbar__thumb" style={horizontal
        ? { inlineSize: thumbSize, transform: `translateX(${thumbOffset}px)` }
        : { blockSize: thumbSize, transform: `translateY(${thumbOffset}px)` }} />
    </div>
  );
}
