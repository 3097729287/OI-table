import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

const defaultWidth = 200;
const minimumWidth = 128;
const maximumWidth = 420;
const keyboardStep = 16;

interface SidebarDrag {
  pointerId: number;
  startX: number;
  startWidth: number;
  direction: number;
}

function inlineDirection(element: HTMLElement) {
  return getComputedStyle(element).direction === "rtl" ? -1 : 1;
}

export function useSidebarResize(visible: boolean) {
  const workbench = useRef<HTMLElement>(null);
  const drag = useRef<SidebarDrag | null>(null);
  const [preferredWidth, setPreferredWidth] = useState(defaultWidth);
  const [maxWidth, setMaxWidth] = useState(maximumWidth);
  const [resizing, setResizing] = useState(false);
  const minWidth = Math.min(minimumWidth, maxWidth);

  useLayoutEffect(() => {
    const element = workbench.current;
    if (!element) return;

    function updateLimit(availableWidth: number) {
      setMaxWidth(Math.min(maximumWidth, Math.floor(availableWidth * 0.45)));
    }

    updateLimit(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => updateLimit(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (visible || !drag.current) return;
    drag.current = null;
    setResizing(false);
  }, [visible]);

  function clamp(width: number) {
    return Math.min(maxWidth, Math.max(minWidth, Math.round(width)));
  }

  function resize(width: number) {
    const nextWidth = clamp(width);
    setPreferredWidth((previous) => nextWidth === clamp(previous) ? previous : nextWidth);
  }

  function start(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !event.isPrimary || drag.current) return;
    const handle = event.currentTarget;
    const sidebar = workbench.current?.querySelector("#workspace-sidebar");
    handle.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: sidebar?.getBoundingClientRect().width ?? width,
      direction: inlineDirection(handle),
    };
    setResizing(true);
  }

  function track(event: PointerEvent<HTMLDivElement>) {
    const session = drag.current;
    if (!session || session.pointerId !== event.pointerId) return;
    resize(session.startWidth + (event.clientX - session.startX) * session.direction);
  }

  function stop(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setResizing(false);
  }

  const width = clamp(preferredWidth);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case "ArrowLeft": resize(width - keyboardStep * inlineDirection(event.currentTarget)); break;
      case "ArrowRight": resize(width + keyboardStep * inlineDirection(event.currentTarget)); break;
      case "Home": resize(minWidth); break;
      case "End": resize(maxWidth); break;
      default: return;
    }
    event.preventDefault();
  }

  return { workbench, width, minWidth, maxWidth, resizing, start, track, stop, handleKeyDown };
}
