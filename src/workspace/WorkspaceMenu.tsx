import { useId, useState, type CSSProperties } from "react";
import { t } from "../i18n";
import { Icon } from "../shared/Icon";
import { workspaceTabId, type WorkspaceTarget } from "./layout";
import { SidebarDisclosure } from "./SidebarDisclosure";
import type { SidebarMenuItem, SidebarMenuSection } from "./sidebarMenu";
import { workspaceViews } from "./views";

interface WorkspaceMenuProps {
  section: SidebarMenuSection;
  onOpen: (target: WorkspaceTarget) => void;
}

export function WorkspaceMenu({ section, onOpen }: WorkspaceMenuProps) {
  const menuId = useId();
  const [expandedGroups, setExpandedGroups] = useState<Partial<Record<string, boolean>>>({});
  const [selectedEntry, setSelectedEntry] = useState<string>();

  function openEntry(target: WorkspaceTarget) {
    setSelectedEntry(workspaceTabId(target));
    onOpen(target);
  }

  function renderItems(items: readonly SidebarMenuItem[], parentId: string, depth = 0) {
    return (
      <ul className="workbench-sidebar__items" style={{ "--menu-indent": `${depth * 12}px` } as CSSProperties}>
        {items.map((item) => {
          if (item.kind === "group") {
            const title = t(item.title);
            const groupId = `${parentId}/${item.id}`;
            const defaultExpanded = depth === 0;
            const expanded = expandedGroups[groupId] ?? defaultExpanded;
            const listId = `${menuId}${groupId}`;
            return (
              <li key={`group:${item.id}`}>
                <button type="button" aria-expanded={expanded} aria-controls={listId} title={title}
                  onClick={() => setExpandedGroups((groups) => ({
                    ...groups,
                    [groupId]: !(groups[groupId] ?? defaultExpanded),
                  }))}>
                  <Icon name="chevronRight" size={15} />
                  <span className="workbench-sidebar__label">{title}</span>
                </button>
                <SidebarDisclosure id={listId} expanded={expanded}>{renderItems(item.children, groupId, depth + 1)}</SidebarDisclosure>
              </li>
            );
          }

          const view = workspaceViews.get(item.viewId);
          if (!view) return null;
          const variant = item.variant === undefined ? undefined : view.variants?.[item.variant];
          if (item.variant !== undefined && !variant) return null;
          const title = t(item.title ?? variant?.title ?? view.title);
          const target = { id: view.id, params: variant?.params ?? {} };
          const id = workspaceTabId(target);
          if (item.Row) {
            return <item.Row key={id} title={title} target={target} depth={depth}
              onOpen={openEntry} selectedEntry={selectedEntry} />;
          }

          return (
            <li key={id}>
              <button type="button" aria-current={selectedEntry === id || undefined} title={title}
                onClick={() => openEntry(target)}>
                <Icon name={variant?.icon ?? view.icon} size={15} />
                <span className="workbench-sidebar__label">{title}</span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return <nav aria-label={t(section.title)}>{renderItems(section.children, section.id)}</nav>;
}
