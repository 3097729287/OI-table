import { useMessages } from "../i18n";
import { SplitSeparator } from "../shared/ui/SplitSeparator";
import type { SplitFrame } from "./layout";

interface PaneSeparatorProps {
  frame: SplitFrame;
  controls: string;
  onResize: (ratio: number) => void;
}

export function PaneSeparator({ frame, controls, onResize }: PaneSeparatorProps) {
  const messages = useMessages();
  const { axis, bounds, ratio, minRatio, maxRatio } = frame;
  const sideBySide = axis === "horizontal";
  const span = sideBySide ? bounds.width : bounds.height;

  return (
    <SplitSeparator className="workbench-pane-separator"
      label={sideBySide ? messages.resizePaneWidth : messages.resizePaneHeight}
      orientation={sideBySide ? "vertical" : "horizontal"} controls={controls}
      value={ratio} min={minRatio} max={maxRatio} pixelsPerUnit={span} onResize={onResize}
      style={sideBySide
        ? { left: bounds.x + span * ratio, top: bounds.y, height: bounds.height }
        : { left: bounds.x, top: bounds.y + span * ratio, width: bounds.width }} />
  );
}
