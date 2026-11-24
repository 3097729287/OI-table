import type { ComponentType } from "react";
import type { MessageKey } from "../i18n";
import type { IconName } from "../shared/Icon";

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

interface WorkspaceViewVariant {
  id: string;
  title: MessageKey;
}

export interface WorkspaceViewOptions {
  title: MessageKey;
  icon: IconName;
  section: WorkspaceSection;
  sidebarTitle?: MessageKey;
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
