import type { ComponentType } from "react";
import { messages } from "../i18n";
import type { IconName } from "../shared/Icon";

export const workspaceSections = {
  catalog: { title: messages.catalog, icon: "catalog" },
  archive: { title: messages.archive, icon: "archive" },
  favorites: { title: messages.favorites, icon: "favorites" },
  submissions: { title: messages.submissionHistory, icon: "submissions" },
} satisfies Record<string, { title: string; icon: IconName }>;

export type WorkspaceSection = keyof typeof workspaceSections;

export interface WorkspaceViewOptions {
  title: string;
  icon: IconName;
  section: WorkspaceSection;
  sidebarTitle?: string;
  order: number;
}

interface ViewModule {
  default: ComponentType;
  workspaceView: WorkspaceViewOptions;
}

const modules = import.meta.glob<ViewModule>("../features/**/view.tsx", { eager: true });

export const workspaceViews = Object.entries(modules)
  .map(([path, view]) => ({
    ...view.workspaceView,
    id: path.slice("../features/".length, -"/view.tsx".length),
    Page: view.default,
  }))
  .sort((a, b) => a.order - b.order);
