import type { ComponentType } from "react";
import type { MessageKey } from "../i18n";
import type { IconName } from "../shared/Icon";
import type { WorkspaceParams, WorkspaceTarget } from "./layout";

export const workspaceSections = {
  catalog: { title: "catalog", icon: "catalog" },
  archive: { title: "archive", icon: "archive" },
  favorites: { title: "favorites", icon: "favorites" },
  submissions: { title: "submissionHistory", icon: "submissions" },
  settings: { title: "settings", icon: "settings" },
} satisfies Record<string, { title: MessageKey; icon: IconName }>;

export type WorkspaceSection = keyof typeof workspaceSections;

interface SidebarGroup {
  id: string;
  title: MessageKey;
}

export interface WorkspaceViewVariant {
  params: WorkspaceParams;
  title: MessageKey;
  icon?: IconName;
}

export interface WorkspaceViewOptions<Variant extends WorkspaceViewVariant = WorkspaceViewVariant> {
  id: string;
  title: MessageKey;
  icon: IconName;
  section: WorkspaceSection;
  sidebarTitle?: MessageKey | false;
  sidebarGroups?: readonly SidebarGroup[];
  variants?: readonly Variant[];
  singleton?: boolean;
  order: number;
}

export interface WorkspaceViewProps extends WorkspaceTarget {
  title: string;
  open: (target: WorkspaceTarget) => void;
}

interface ViewModule {
  default: ComponentType<WorkspaceViewProps>;
  workspaceView: WorkspaceViewOptions;
}

const modules = import.meta.glob<ViewModule>("../features/**/view.tsx", { eager: true });

export const workspaceViews = Object.values(modules)
  .map(({ workspaceView, default: Page }) => ({ ...workspaceView, Page }))
  .sort((a, b) => a.order - b.order);

export type WorkspaceView = (typeof workspaceViews)[number];

export function workspaceEntries(view: WorkspaceView) {
  const entries: { target: WorkspaceTarget; title: MessageKey; icon: IconName }[] = [];
  if (view.sidebarTitle !== false) {
    entries.push({ target: { id: view.id, params: {} }, title: view.sidebarTitle ?? view.title, icon: view.icon });
  }
  for (const variant of view.variants ?? []) {
    entries.push({
      target: { id: view.id, params: variant.params },
      title: variant.title,
      icon: variant.icon ?? view.icon,
    });
  }
  return entries;
}
