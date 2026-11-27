import { createElement, useId, useRef, type ComponentProps, type RefObject } from "react";
import { t } from "../../i18n";
import { Scrollbar, type ScrollOrientation } from "./Scrollbar";

interface ScrollAreaProps extends ComponentProps<"div"> {
  as?: "div" | "aside" | "section";
  viewportRef?: RefObject<HTMLDivElement | null>;
  focusScrollbar?: boolean;
  orientation?: ScrollOrientation | "both";
}

export function ScrollArea({
  as = "div", className, children, viewportRef, focusScrollbar, orientation = "both", ...props
}: ScrollAreaProps) {
  const defaultViewport = useRef<HTMLDivElement>(null);
  const viewport = viewportRef ?? defaultViewport;
  const id = useId();
  return createElement(as, { ...props, className: className ? `scroll-area ${className}` : "scroll-area" },
    <div id={id} ref={viewport} className="scroll-area__viewport">{children}</div>,
    orientation !== "horizontal" && <Scrollbar viewport={viewport} controls={id} orientation="vertical"
      label={t("scrollVertically")} focusable={focusScrollbar} />,
    orientation !== "vertical" && <Scrollbar viewport={viewport} controls={id} orientation="horizontal"
      label={t("scrollHorizontally")} focusable={focusScrollbar} />,
  );
}
