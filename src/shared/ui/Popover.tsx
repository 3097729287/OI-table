import { useId, useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import "./floating-surface.css";

interface PopoverProps {
  label: string;
  trigger: ReactNode;
  triggerProps?: ComponentPropsWithoutRef<"button"> & { [attribute: `data-${string}`]: string | number | boolean | undefined };
  className?: string;
  children: (id: string) => ReactNode;
}

function placePopover(anchor: HTMLButtonElement, panel: HTMLDivElement) {
  const bounds = anchor.getBoundingClientRect();
  const gap = 6;
  const maxHeight = 340;
  const center = bounds.left + bounds.width / 2;
  const viewportWidth = window.innerWidth;
  const centeredWidth = 2 * (Math.min(center, viewportWidth - center) - gap);
  const preferredWidth = Math.min(240, Math.max(184, centeredWidth));
  const width = Math.max(0, Math.min(preferredWidth, viewportWidth - 2 * gap));
  const below = window.innerHeight - bounds.bottom - 2 * gap;
  const above = bounds.top - 2 * gap;
  const opensAbove = below < maxHeight && above > below;
  const left = Math.max(gap, Math.min(center - width / 2, viewportWidth - width - gap));
  const originX = Math.max(0, Math.min(width, center - left));

  panel.style.width = `${width}px`;
  panel.style.left = `${left}px`;
  panel.style.maxHeight = `${Math.max(0, Math.min(maxHeight, opensAbove ? above : below))}px`;
  panel.style.top = opensAbove ? "auto" : `${bounds.bottom + gap}px`;
  panel.style.bottom = opensAbove ? `${window.innerHeight - bounds.top + gap}px` : "auto";
  panel.style.transformOrigin = `${originX}px ${opensAbove ? "bottom" : "top"}`;
}

export function Popover({ label, trigger, triggerProps, className, children }: PopoverProps) {
  const id = useId();
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const button = anchor.current;
    const popover = panel.current;
    if (!open || !button || !popover) return;

    const reposition = () => {
      if (popover.matches(":popover-open")) placePopover(button, popover);
    };
    const repositionAfterScroll = (event: Event) => {
      if (!(event.target instanceof Node) || !popover.contains(event.target)) reposition();
    };
    const size = new ResizeObserver(reposition);
    // A divider can move the trigger without changing its own dimensions.
    for (let element: HTMLElement | null = button; element; element = element.parentElement) size.observe(element);
    const visibility = new IntersectionObserver(([entry]) => {
      const { width, height } = entry.intersectionRect;
      if ((!width || !height) && popover.matches(":popover-open")) popover.hidePopover();
      else reposition();
    });
    visibility.observe(button);
    window.addEventListener("resize", reposition);
    document.addEventListener("scroll", repositionAfterScroll, { capture: true, passive: true });
    return () => {
      size.disconnect();
      visibility.disconnect();
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", repositionAfterScroll, true);
    };
  }, [open]);

  return (
    <>
      <button {...triggerProps} ref={anchor} type="button" popoverTarget={id} aria-haspopup="dialog"
        aria-label={triggerProps?.["aria-label"] ?? label} aria-expanded={open} aria-controls={id}>
        {trigger}
      </button>
      <div id={id} ref={panel} popover="auto" role="dialog" aria-label={label}
        className={className ? `floating-surface popover-surface ${className}` : "floating-surface popover-surface"}
        onBeforeToggle={(event) => {
          if (event.target === event.currentTarget && event.newState === "open" && anchor.current) {
            placePopover(anchor.current, event.currentTarget);
          }
        }}
        onToggle={(event) => {
          if (event.target === event.currentTarget) setOpen(event.newState === "open");
        }}>
        {open && children(id)}
      </div>
    </>
  );
}
