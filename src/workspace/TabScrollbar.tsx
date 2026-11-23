import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

const scrollStep = 32;
const minThumbWidth = 24;

interface TabScrollbarProps {
  viewport: RefObject<HTMLDivElement | null>;
  content: RefObject<HTMLDivElement | null>;
  controls: string;
  label: string;
}

export function TabScrollbar({ viewport, content, controls, label }: TabScrollbarProps) {
  const [position, setPosition] = useState({ width: 0, max: 0, offset: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointerId: number; grabOffset: number } | null>(null);

  useLayoutEffect(() => {
    const strip = viewport.current;
    const row = content.current;
    if (!strip || !row) return;

    const measure = () => {
      const width = strip.clientWidth;
      const max = Math.max(0, strip.scrollWidth - width);
      const offset = Math.max(0, Math.min(max, strip.scrollLeft));
      setPosition((previous) => (
        previous.width === width && previous.max === max && previous.offset === offset
          ? previous
          : { width, max, offset }
      ));
    };

    const scrollWithWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || event.defaultPrevented) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? scrollStep
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? strip.clientWidth : 1;
      const before = strip.scrollLeft;
      strip.scrollLeft += delta * unit;
      if (strip.scrollLeft !== before && event.cancelable) event.preventDefault();
    };

    measure();
    const wheelRegion = strip.parentElement;
    strip.addEventListener("scroll", measure, { passive: true });
    wheelRegion?.addEventListener("wheel", scrollWithWheel, { passive: false });
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    observer.observe(row);
    return () => {
      strip.removeEventListener("scroll", measure);
      wheelRegion?.removeEventListener("wheel", scrollWithWheel);
      observer.disconnect();
    };
  }, [viewport, content]);

  const { width, max, offset } = position;
  const overflow = width > 0 && max > 0;
  const thumbWidth = overflow ? Math.max(width * width / (width + max), Math.min(minThumbWidth, width / 2)) : 0;
  const travel = width - thumbWidth;
  const thumbOffset = overflow ? offset / max * travel : 0;

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    const strip = viewport.current;
    if (!strip || event.button !== 0 || !event.isPrimary || !overflow) return;

    const track = event.currentTarget;
    const x = event.clientX - track.getBoundingClientRect().left;
    track.focus({ preventScroll: true });
    event.preventDefault();
    if (x < thumbOffset || x > thumbOffset + thumbWidth) {
      strip.scrollLeft += x < thumbOffset ? -width : width;
      return;
    }

    track.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, grabOffset: x - thumbOffset };
    setDragging(true);
  }

  function moveThumb(event: PointerEvent<HTMLDivElement>) {
    const strip = viewport.current;
    const session = drag.current;
    if (!strip || session?.pointerId !== event.pointerId || !overflow || travel <= 0) return;

    const x = event.clientX - event.currentTarget.getBoundingClientRect().left;
    strip.scrollLeft = (x - session.grabOffset) / travel * max;
  }

  function stopDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
  }

  function scrollWithKey(event: KeyboardEvent<HTMLDivElement>) {
    const strip = viewport.current;
    if (!strip) return;
    let target: number;
    switch (event.key) {
      case "ArrowLeft": target = strip.scrollLeft - scrollStep; break;
      case "ArrowRight": target = strip.scrollLeft + scrollStep; break;
      case "PageUp": target = strip.scrollLeft - width; break;
      case "PageDown": target = strip.scrollLeft + width; break;
      case "Home": target = 0; break;
      case "End": target = max; break;
      default: return;
    }
    event.preventDefault();
    strip.scrollLeft = target;
  }

  return (
    <div className="pane-tab-scrollbar" role="scrollbar" tabIndex={overflow ? 0 : -1}
      aria-hidden={!overflow} data-overflow={overflow}
      aria-label={label} aria-controls={controls} aria-orientation="horizontal"
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={overflow ? Math.round(offset / max * 100) : 0}
      data-dragging={dragging} onPointerDown={startDrag} onPointerMove={moveThumb}
      onPointerUp={stopDrag} onPointerCancel={stopDrag} onLostPointerCapture={stopDrag} onKeyDown={scrollWithKey}>
      <span className="pane-tab-scrollbar__thumb"
        style={{ width: thumbWidth, transform: `translateX(${thumbOffset}px)` }} />
    </div>
  );
}
