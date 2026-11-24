import { useState, type CSSProperties } from "react";
import { useMessages, type MessageKey } from "../i18n";
import { Icon, type IconName } from "../shared/Icon";
import { workspaceSections, workspaceViews, type WorkspaceSection } from "./views";

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

    children.push({ kind: "view", id: view.id, title: view.sidebarTitle ?? view.title, icon: view.icon });
  }

  return items;
}

interface WorkspaceMenuProps {
  section: WorkspaceSection;
  onOpen: (view: string) => void;
}

export function WorkspaceMenu({ section, onOpen }: WorkspaceMenuProps) {
  const messages = useMessages();
  const [expandedGroups, setExpandedGroups] = useState<Partial<Record<string, boolean>>>({});
  const [selectedView, setSelectedView] = useState<string>();

  function renderItems(items: readonly MenuItem[], depth = 0) {
    return (
      <ul className="workbench-sidebar__items" style={{ "--menu-indent": `${depth * 12}px` } as CSSProperties}>
        {items.map((item) => {
          const title = messages[item.title];
          if (item.kind === "group") {
            const defaultExpanded = depth === 0;
            const expanded = expandedGroups[item.id] ?? defaultExpanded;
            return (
              <li key={`group:${item.id}`}>
                <button type="button" aria-expanded={expanded} title={title}
                  onClick={() => setExpandedGroups((groups) => ({
                    ...groups,
                    [item.id]: !(groups[item.id] ?? defaultExpanded),
                  }))}>
                  <Icon name="chevronRight" size={15} />
                  <span className="workbench-sidebar__label">{title}</span>
                </button>
                {expanded && renderItems(item.children, depth + 1)}
              </li>
            );
          }

          return (
            <li key={item.id}>
              <button type="button" aria-current={selectedView === item.id || undefined} title={title}
                onClick={() => {
                  setSelectedView(item.id);
                  onOpen(item.id);
                }}>
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
