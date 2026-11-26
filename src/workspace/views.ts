import type { ComponentType } from "react";
import type { MessageKey } from "../i18n";
import type { IconName } from "../shared/Icon";
import type { WorkspaceParams, WorkspaceTarget } from "./layout";

export interface WorkspaceViewVariant {
  params: WorkspaceParams;
  title: MessageKey;
  icon?: IconName;
}

export interface WorkspaceViewOptions<Variant extends WorkspaceViewVariant = WorkspaceViewVariant> {
  id: string;
  title: MessageKey;
  icon: IconName;
  variants?: Readonly<Record<string, Variant>>;
  singleton?: boolean;
}

export interface WorkspaceViewProps extends WorkspaceTarget {
  title: string;
  open: (target: WorkspaceTarget) => void;
}

export interface WorkspaceView extends WorkspaceViewOptions {
  Page: ComponentType<WorkspaceViewProps>;
}

interface ViewModule {
  default: WorkspaceView["Page"];
  workspaceView: WorkspaceViewOptions;
}

const modules = import.meta.glob<ViewModule>("../features/**/view.tsx", { eager: true });

export const workspaceViews: ReadonlyMap<string, WorkspaceView> = new Map(
  Object.values(modules).map(({ workspaceView, default: Page }) => [
    workspaceView.id, { ...workspaceView, Page },
  ]),
);
