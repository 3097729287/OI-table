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

interface SidebarGroup {
  id: string;
  title: string;
}

interface WorkspaceViewVariant {
  id: string;
  title: string;
}

export interface WorkspaceViewOptions {
  title: string;
  icon: IconName;
  section: WorkspaceSection;
  sidebarTitle?: string;
  sidebarGroups?: readonly SidebarGroup[];
  variants?: readonly WorkspaceViewVariant[];
  order: number;
}

export interface WorkspaceViewProps {
  title: string;
}

interface ViewModule {
  default: ComponentType<WorkspaceViewProps>;
  workspaceView: WorkspaceViewOptions;
}

const modules = import.meta.glob<ViewModule>("../features/**/view.tsx", { eager: true });

export const workspaceViews = Object.entries(modules)
  .sort(([, a], [, b]) => a.workspaceView.order - b.workspaceView.order)
  .flatMap(([path, view]) => {
    const id = path.slice("../features/".length, -"/view.tsx".length);
    const { variants = [], ...options } = view.workspaceView;
    const base = { ...options, id, Page: view.default };

    return [
      base,
      ...variants.map((variant) => ({
        ...base,
        id: `${id}:${variant.id}`,
        title: variant.title,
        sidebarTitle: variant.title,
      })),
    ];
  });
