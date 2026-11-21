import catalog from "./icons/catalog.svg?no-inline";
import close from "./icons/close.svg?no-inline";
import editor from "./icons/editor.svg?no-inline";
import maximize from "./icons/maximize.svg?no-inline";
import minimize from "./icons/minimize.svg?no-inline";
import problemLists from "./icons/problem-lists.svg?no-inline";
import problems from "./icons/problems.svg?no-inline";
import restore from "./icons/restore.svg?no-inline";
import scratchPad from "./icons/scratch-pad.svg?no-inline";
import settings from "./icons/settings.svg?no-inline";
import sidebarHidden from "./icons/sidebar-hidden.svg?no-inline";
import sidebarVisible from "./icons/sidebar-visible.svg?no-inline";
import "./icons/icon.css";

const sources = {
  catalog,
  close,
  editor,
  maximize,
  minimize,
  problemLists,
  problems,
  restore,
  scratchPad,
  settings,
  sidebarHidden,
  sidebarVisible,
};

export type IconName = keyof typeof sources;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <span
      className="app-icon"
      aria-hidden="true"
      style={{ width: size, height: size, maskImage: `url("${sources[name]}")` }}
    />
  );
}
