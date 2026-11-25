import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import "./split-separator.css";

const keyboardStep = 16;

interface SplitSeparatorProps {
  className: string;
  orientation: "horizontal" | "vertical";
  label: string;
  controls: string;
  value: number;
  min: number;
  max: number;
  onResize(value: number): void;
  /** CSS pixels per unit of value. For a ratio this is the available span. */
  pixelsPerUnit?: number;
  followsInlineDirection?: boolean;
  focusOnPointerDown?: boolean;
  hidden?: boolean;
  style?: CSSProperties;
}

interface DragSession {
  pointerId: number;
  start: number;
  value: number;
  direction: number;
}

export function SplitSeparator({ className, orientation, label, controls, value, min, max, onResize,
  pixelsPerUnit = 1, followsInlineDirection = false, focusOnPointerDown = false, hidden, style }: SplitSeparatorProps) {
  const separator = useRef<HTMLDivElement>(null);
  const drag = useRef<DragSession | null>(null);
  const [resizing, setResizing] = useState(false);
  const vertical = orientation === "vertical";
  const minPixels = Math.round(min * pixelsPerUnit);
  const maxPixels = Math.round(max * pixelsPerUnit);
  const adjustable = !hidden && minPixels < maxPixels;

  useLayoutEffect(() => {
    if (adjustable || !drag.current) return;
    const { pointerId } = drag.current;
    drag.current = null;
    if (separator.current?.hasPointerCapture(pointerId)) separator.current.releasePointerCapture(pointerId);
    setResizing(false);
  }, [adjustable]);

  function inlineDirection(element: HTMLElement) {
    return vertical && followsInlineDirection && getComputedStyle(element).direction === "rtl" ? -1 : 1;
  }

  function coordinate(event: PointerEvent<HTMLDivElement>) {
    return vertical ? event.clientX : event.clientY;
  }

  function resize(next: number) {
    onResize(Math.min(max, Math.max(min, next)));
  }

  function start(event: PointerEvent<HTMLDivElement>) {
    if (!adjustable || event.button !== 0 || !event.isPrimary || drag.current) return;

    event.preventDefault();
    const handle = event.currentTarget;
    if (focusOnPointerDown) handle.focus({ preventScroll: true });
    handle.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, start: coordinate(event), value, direction: inlineDirection(handle) };
    setResizing(true);
  }

  function track(event: PointerEvent<HTMLDivElement>) {
    const session = drag.current;
    if (!adjustable || session?.pointerId !== event.pointerId) return;
    const delta = (coordinate(event) - session.start) * session.direction;
    resize(session.value + delta / pixelsPerUnit);
  }

  function stop(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setResizing(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!adjustable) return;
    const step = keyboardStep * inlineDirection(event.currentTarget) / pixelsPerUnit;
    let next: number;
    switch (event.key) {
      case vertical ? "ArrowLeft" : "ArrowUp": next = value - step; break;
      case vertical ? "ArrowRight" : "ArrowDown": next = value + step; break;
      case "Home": next = min; break;
      case "End": next = max; break;
      default: return;
    }
    event.preventDefault();
    resize(next);
  }

  return (
    <div ref={separator} className={`split-separator ${className}`} style={style} hidden={hidden}
      role="separator" tabIndex={adjustable ? 0 : -1} aria-label={label} aria-orientation={orientation}
      aria-controls={controls} aria-valuemin={hidden ? undefined : minPixels} aria-valuemax={hidden ? undefined : maxPixels}
      aria-valuenow={hidden ? undefined : Math.round(value * pixelsPerUnit)} aria-disabled={!adjustable || undefined}
      data-resizing={resizing} onPointerDown={start} onPointerMove={track}
      onPointerUp={(event) => { track(event); stop(event); }} onPointerCancel={stop}
      onLostPointerCapture={stop} onKeyDown={handleKeyDown} />
  );
}
