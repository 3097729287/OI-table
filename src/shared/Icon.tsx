import activity from "./icons/activity.svg?no-inline";
import appearance from "./icons/appearance.svg?no-inline";
import archive from "./icons/archive.svg?no-inline";
import arrowLeft from "./icons/arrow-left.svg?no-inline";
import catalog from "./icons/catalog.svg?no-inline";
import check from "./icons/check.svg?no-inline";
import chevronRight from "./icons/chevron-right.svg?no-inline";
import close from "./icons/close.svg?no-inline";
import collapseAll from "./icons/collapse-all.svg?no-inline";
import copy from "./icons/copy.svg?no-inline";
import debug from "./icons/debug.svg?no-inline";
import editor from "./icons/editor.svg?no-inline";
import favoriteFilled from "./icons/favorite-filled.svg?no-inline";
import favorites from "./icons/favorites.svg?no-inline";
import fillInput from "./icons/fill-input.svg?no-inline";
import info from "./icons/info.svg?no-inline";
import maximize from "./icons/maximize.svg?no-inline";
import minimize from "./icons/minimize.svg?no-inline";
import pending from "./icons/pending.svg?no-inline";
import plus from "./icons/plus.svg?no-inline";
import problemLists from "./icons/problem-lists.svg?no-inline";
import problems from "./icons/problems.svg?no-inline";
import restore from "./icons/restore.svg?no-inline";
import run from "./icons/run.svg?no-inline";
import settings from "./icons/settings.svg?no-inline";
import sidebarHidden from "./icons/sidebar-hidden.svg?no-inline";
import sidebarVisible from "./icons/sidebar-visible.svg?no-inline";
import spinner from "./icons/spinner.svg?no-inline";
import splitColumns from "./icons/split-columns.svg?no-inline";
import stepInto from "./icons/step-into.svg?no-inline";
import stepOut from "./icons/step-out.svg?no-inline";
import stepOver from "./icons/step-over.svg?no-inline";
import stop from "./icons/stop.svg?no-inline";
import submissions from "./icons/submissions.svg?no-inline";
import warning from "./icons/warning.svg?no-inline";
import "./icons/icon.css";

const sources = {
  activity,
  appearance,
  archive,
  arrowLeft,
  catalog,
  check,
  chevronRight,
  close,
  collapseAll,
  copy,
  debug,
  editor,
  favoriteFilled,
  favorites,
  fillInput,
  info,
  maximize,
  minimize,
  pending,
  plus,
  problemLists,
  problems,
  restore,
  run,
  settings,
  sidebarHidden,
  sidebarVisible,
  spinner,
  splitColumns,
  stepInto,
  stepOut,
  stepOver,
  stop,
  submissions,
  warning,
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
