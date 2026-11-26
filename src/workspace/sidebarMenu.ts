import type { ComponentType, ReactNode } from "react";
import type { MessageKey } from "../i18n";
import type { IconName } from "../shared/Icon";
import type { WorkspaceTarget } from "./layout";

export interface SidebarRowProps {
  title: string;
  target: WorkspaceTarget;
  depth: number;
  selectedEntry?: string;
  onOpen: (target: WorkspaceTarget) => void;
}

export type SidebarMenuItem =
  | { kind: "group"; id: string; title: MessageKey; children: readonly SidebarMenuItem[] }
  | { kind: "view"; viewId: string; variant?: string; title?: MessageKey; Row?: ComponentType<SidebarRowProps> };

export interface WorkspaceProviderProps {
  activeTarget?: WorkspaceTarget;
  openSidebar: (id: string) => void;
  revealTarget: (target: WorkspaceTarget) => void;
  children: ReactNode;
}

interface SidebarSectionInfo {
  id: string;
  title: MessageKey;
  icon: IconName;
  order: number;
  Provider?: ComponentType<WorkspaceProviderProps>;
}

export type SidebarMenuSection = SidebarSectionInfo & {
  children: readonly SidebarMenuItem[];
  Panel?: never;
};

export type SidebarSection = SidebarMenuSection | (SidebarSectionInfo & {
  Panel: ComponentType;
  children?: never;
});

const modules = import.meta.glob<SidebarSection>("../features/**/sidebar.ts", { eager: true, import: "default" });

export const workspaceSections = Object.values(modules).sort((a, b) => a.order - b.order);
