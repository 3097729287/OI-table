import { useId, useState, type CSSProperties } from "react";
import { ArchiveNavigation, CatalogNavigation } from "../features/catalog/LibraryNavigation";
import { FavoritesNavigation } from "../features/personal/PersonalNavigation";
import { useMessages, type MessageKey } from "../i18n";
import { Icon, type IconName } from "../shared/Icon";
import { workspaceTabId, type WorkspaceTarget } from "./layout";
import { SidebarDisclosure } from "./SidebarDisclosure";
import { workspaceEntries, workspaceSections, workspaceViews, type WorkspaceSection } from "./views";

interface MenuGroup {
  kind: "group";
  id: string;
  title: MessageKey;
  children: MenuItem[];
}

type MenuItem = MenuGroup | {
  kind: "view";
  id: string;
  title: MessageKey;
  icon: IconName;
  target: WorkspaceTarget;
};

function buildMenu(section: WorkspaceSection) {
  const items: MenuItem[] = [];

  for (const view of workspaceViews) {
    if (view.section !== section) continue;

    let children = items;
    let groupPath: string = section;
    for (const group of view.sidebarGroups ?? []) {
      groupPath = `${groupPath}/${group.id}`;
      let entry = children.find((item): item is MenuGroup => item.kind === "group" && item.id === groupPath);
      if (!entry) {
        entry = { kind: "group", id: groupPath, title: group.title, children: [] };
        children.push(entry);
      }
      children = entry.children;
    }

    for (const entry of workspaceEntries(view)) {
      children.push({ kind: "view", id: workspaceTabId(entry.target), ...entry });
    }
  }

  return items;
}

interface WorkspaceMenuProps {
  section: WorkspaceSection;
  onOpen: (target: WorkspaceTarget) => void;
}

export function WorkspaceMenu({ section, onOpen }: WorkspaceMenuProps) {
  const messages = useMessages();
  const menuId = useId();
  const [expandedGroups, setExpandedGroups] = useState<Partial<Record<string, boolean>>>({});
  const [selectedEntry, setSelectedEntry] = useState<string>();

  function openEntry(target: WorkspaceTarget) {
    setSelectedEntry(workspaceTabId(target));
    onOpen(target);
  }

  function renderItems(items: readonly MenuItem[], depth = 0) {
    return (
      <ul className="workbench-sidebar__items" style={{ "--menu-indent": `${depth * 12}px` } as CSSProperties}>
        {items.map((item) => {
          const title = messages[item.title];
          if (item.kind === "group") {
            const defaultExpanded = depth === 0;
            const expanded = expandedGroups[item.id] ?? defaultExpanded;
            const listId = `${menuId}${item.id}`;
            return (
              <li key={`group:${item.id}`}>
                <button type="button" aria-expanded={expanded} aria-controls={listId} title={title}
                  onClick={() => setExpandedGroups((groups) => ({
                    ...groups,
                    [item.id]: !(groups[item.id] ?? defaultExpanded),
                  }))}>
                  <Icon name="chevronRight" size={15} />
                  <span className="workbench-sidebar__label">{title}</span>
                </button>
                <SidebarDisclosure id={listId} expanded={expanded}>{renderItems(item.children, depth + 1)}</SidebarDisclosure>
              </li>
            );
          }

          if (item.id === "catalog") {
            return <CatalogNavigation key={item.id} onOpen={openEntry} selectedEntry={selectedEntry} />;
          }
          if (item.id === "favorites") {
            return <FavoritesNavigation key={item.id} depth={depth} onOpen={openEntry} selectedEntry={selectedEntry} />;
          }
          if (item.target.id === "archive") {
            return <ArchiveNavigation key={item.id} title={title} target={item.target} depth={depth}
              onOpen={openEntry} selectedEntry={selectedEntry} />;
          }

          return (
            <li key={item.id}>
              <button type="button" aria-current={selectedEntry === item.id || undefined} title={title}
                onClick={() => openEntry(item.target)}>
                <Icon name={item.icon} size={15} />
                <span className="workbench-sidebar__label">{title}</span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return <nav aria-label={messages[workspaceSections[section].title]}>{renderItems(buildMenu(section))}</nav>;
}
