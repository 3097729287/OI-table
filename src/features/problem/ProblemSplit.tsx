import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { SplitSeparator } from "../../shared/ui/SplitSeparator";
import "./problem-split.css";

const minimumPrimaryWidth = 260;
const minimumSecondaryWidth = 240;
const separatorWidth = 12;

interface ProblemSplitProps {
  children: ReactNode;
  secondary: ReactNode;
  enabled: boolean;
  singlePane: "primary" | "secondary";
  onSplitChange(split: boolean): void;
  label: string;
}

export function ProblemSplit({ children, secondary, enabled, singlePane, onSplitChange, label }: ProblemSplitProps) {
  const container = useRef<HTMLDivElement>(null);
  const primaryId = useId();
  const [width, setWidth] = useState(0);
  const [preferredRatio, setPreferredRatio] = useState(0.44);
  const availableWidth = width - separatorWidth;
  const maximumPrimaryWidth = availableWidth - minimumSecondaryWidth;
  const split = enabled && maximumPrimaryWidth >= minimumPrimaryWidth;

  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;

    setWidth(Math.floor(element.getBoundingClientRect().width));
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => onSplitChange(split), [split, onSplitChange]);

  const primaryWidth = Math.max(minimumPrimaryWidth, Math.min(maximumPrimaryWidth, Math.round(availableWidth * preferredRatio)));

  function resize(nextWidth: number) {
    const rounded = Math.round(nextWidth);
    if (rounded !== primaryWidth) setPreferredRatio(rounded / availableWidth);
  }

  return (
    <div ref={container} className="problem-split" data-split={split} style={{
      "--problem-split-primary-width": `${primaryWidth}px`,
      "--problem-split-separator-width": `${separatorWidth}px`,
    } as CSSProperties}>
      <div id={primaryId} className="problem-split__primary" hidden={!split && singlePane !== "primary"}>
        {children}
      </div>
      <SplitSeparator className="problem-split__separator" orientation="vertical" label={label} controls={primaryId}
        hidden={!split} value={primaryWidth} min={minimumPrimaryWidth} max={maximumPrimaryWidth}
        onResize={resize} followsInlineDirection focusOnPointerDown />
      <div className="problem-split__secondary" hidden={!split && singlePane !== "secondary"}>
        {secondary}
      </div>
    </div>
  );
}
