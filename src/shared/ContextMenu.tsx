import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ScrollArea } from "./ui/ScrollArea";
import "./context-menu.css";

export interface ContextMenuItem<Extra = unknown> {
  id: string;
  label: string;
  enabled?: boolean | (() => boolean);
  shortcut?: string;
  extra?: Extra;
  onSelect: (item: ContextMenuItem<Extra>) => void;
}

interface ContextMenuProps<Extra> {
  x: number;
  y: number;
  label: string;
  items: readonly ContextMenuItem<Extra>[];
  onDismiss: (restoreFocus: boolean) => void;
}

export function ContextMenu<Extra>({ x, y, label, items, onDismiss }: ContextMenuProps<Extra>) {
  const menu = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;

    const gap = 4;
    const { offsetWidth: width, offsetHeight: height } = element;
    const left = Math.max(gap, Math.min(x, window.innerWidth - width - gap));
    const top = Math.max(gap, Math.min(y, window.innerHeight - height - gap));
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    const originX = Math.max(0, Math.min(width, x - left));
    const originY = Math.max(0, Math.min(height, y - top));
    element.style.transformOrigin = `${originX}px ${originY}px`;
    const active = document.activeElement;
    if (!element.contains(active) || active?.matches("button:disabled")) {
      const first = element.querySelector<HTMLButtonElement>("button:enabled") ?? element;
      first.focus({ preventScroll: true });
    }
  }, [items, x, y]);

  useEffect(() => {
    const dismiss = () => onDismiss(false);
    const dismissOutside = (event: Event) => {
      const element = menu.current;
      if (element && event.target instanceof Node && !element.contains(event.target)) dismiss();
    };

    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("scroll", dismissOutside, { capture: true, passive: true });
    window.addEventListener("blur", dismiss);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("scroll", dismissOutside, true);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("resize", dismiss);
    };
  }, [onDismiss]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      onDismiss(true);
      return;
    }

    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:enabled"));
    const index = items.findIndex((item) => item === document.activeElement);
    const last = items.length - 1;
    let next: number;
    switch (event.key) {
      case "ArrowUp": next = index <= 0 ? last : index - 1; break;
      case "ArrowDown": next = index >= last ? 0 : index + 1; break;
      case "Home": next = 0; break;
      case "End": next = last; break;
      default: return;
    }

    event.preventDefault();
    items[next]?.focus();
  }

  return createPortal(
    <ScrollArea ref={menu} className="context-menu" role="menu" aria-label={label} tabIndex={-1}
      orientation="vertical" focusScrollbar={false} onKeyDown={handleKeyDown}>
      {items.map((item) => {
        const { id, label, enabled, shortcut, onSelect } = item;
        const available = typeof enabled === "function" ? enabled() : enabled !== false;
        return (
          <button key={id} type="button" role="menuitem" tabIndex={-1}
            aria-keyshortcuts={shortcut} disabled={!available}
            onClick={() => {
              onDismiss(false);
              onSelect(item);
            }}>
            <span>{label}</span>
            {shortcut && <span className="context-menu__shortcut" aria-hidden="true">{shortcut}</span>}
          </button>
        );
      })}
    </ScrollArea>,
    document.body,
  );
}
