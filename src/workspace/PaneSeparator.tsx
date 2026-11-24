import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useMessages } from "../i18n";
import type { SplitFrame } from "./layout";

const keyboardStep = 16;

interface PaneSeparatorProps {
  frame: SplitFrame;
  controls: string;
  onResize: (ratio: number) => void;
}

export function PaneSeparator({ frame, controls, onResize }: PaneSeparatorProps) {
  const messages = useMessages();
  const drag = useRef<{ pointerId: number; start: number; ratio: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  const { axis, bounds, ratio, minRatio, maxRatio } = frame;
  const sideBySide = axis === "horizontal";
  const span = sideBySide ? bounds.width : bounds.height;
  const min = Math.round(span * minRatio);
  const max = Math.round(span * maxRatio);
  const adjustable = max > min;

  function resize(value: number) {
    onResize(Math.min(maxRatio, Math.max(minRatio, value)));
  }

  function coordinate(event: PointerEvent<HTMLDivElement>) {
    return sideBySide ? event.clientX : event.clientY;
  }

  function start(event: PointerEvent<HTMLDivElement>) {
    if (!adjustable || event.button !== 0 || !event.isPrimary || drag.current) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, start: coordinate(event), ratio };
    setResizing(true);
  }

  function track(event: PointerEvent<HTMLDivElement>) {
    const session = drag.current;
    if (session?.pointerId === event.pointerId && adjustable) {
      resize(session.ratio + (coordinate(event) - session.start) / span);
    }
  }

  function stop(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setResizing(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!adjustable) return;
    const shrink = sideBySide ? "ArrowLeft" : "ArrowUp";
    const grow = sideBySide ? "ArrowRight" : "ArrowDown";
    let next: number;
    switch (event.key) {
      case shrink: next = ratio - keyboardStep / span; break;
      case grow: next = ratio + keyboardStep / span; break;
      case "Home": next = minRatio; break;
      case "End": next = maxRatio; break;
      default: return;
    }
    event.preventDefault();
    resize(next);
  }

  return (
    <div className="workbench-pane-separator" role="separator" tabIndex={adjustable ? 0 : -1}
      aria-label={sideBySide ? messages.resizePaneWidth : messages.resizePaneHeight}
      aria-orientation={sideBySide ? "vertical" : "horizontal"} aria-controls={controls}
      aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(span * ratio)}
      aria-disabled={!adjustable || undefined} data-resizing={resizing}
      style={sideBySide
        ? { left: bounds.x + span * ratio, top: bounds.y, height: bounds.height }
        : { left: bounds.x, top: bounds.y + span * ratio, width: bounds.width }}
      onPointerDown={start} onPointerMove={track} onPointerUp={(event) => {
        track(event);
        stop(event);
      }} onPointerCancel={stop} onLostPointerCapture={stop} onKeyDown={handleKeyDown} />
  );
}
