import { useId, useRef, type CSSProperties, type ReactNode } from "react";
import { useMessages } from "../i18n";
import { Icon } from "../shared/Icon";
import { workspaceTabId } from "./layout";
import { SidebarDisclosure } from "./SidebarDisclosure";
import type { SidebarRowProps } from "./sidebarMenu";

export interface SidebarBranchMenuPosition {
  anchor: HTMLButtonElement;
  x: number;
  y: number;
}

interface SidebarBranchProps extends SidebarRowProps {
  count?: number;
  expanded: boolean;
  loading?: boolean;
  onToggle: () => void;
  onMenu?: (position: SidebarBranchMenuPosition) => void;
  children: ReactNode;
}

export function SidebarBranch({
  title, target, depth, selectedEntry, onOpen, count, expanded, loading, onToggle, onMenu, children,
}: SidebarBranchProps) {
  const messages = useMessages();
  const listId = useId();
  const openButton = useRef<HTMLButtonElement>(null);
  const selected = selectedEntry === workspaceTabId(target);
  const toggleLabel = messages.sidebarToggleBranch.replace("{title}", () => title);
  const indent = { "--menu-indent": `${Math.min((depth + 1) * 12, 60)}px` } as CSSProperties;

  return (
    <li>
      <div className="workbench-sidebar__branch-row" data-current={selected || undefined}
        onContextMenu={onMenu && ((event) => {
          const anchor = openButton.current;
          if (!anchor) return;
          event.preventDefault();
          onMenu({ anchor, x: event.clientX, y: event.clientY });
        })}>
        <button type="button" className="workbench-sidebar__branch-toggle" aria-expanded={expanded}
          aria-controls={listId} aria-label={toggleLabel} title={toggleLabel} onClick={onToggle}>
          <Icon name="chevronRight" size={15} />
        </button>
        <button ref={openButton} type="button" className="workbench-sidebar__branch-open"
          aria-current={selected || undefined} aria-haspopup={onMenu ? "menu" : undefined}
          title={title} onClick={() => onOpen(target)} onKeyDown={onMenu && ((event) => {
            if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
            event.preventDefault();
            const anchor = event.currentTarget;
            const { left, bottom } = anchor.getBoundingClientRect();
            onMenu({ anchor, x: left, y: bottom });
          })}>
          <span className="workbench-sidebar__label">{title}</span>
          {count !== undefined && <span className="workbench-sidebar__branch-count">{count}</span>}
        </button>
      </div>
      <SidebarDisclosure id={listId} expanded={expanded} loading={loading}>
        <ul className="workbench-sidebar__items" style={indent}>{children}</ul>
      </SidebarDisclosure>
    </li>
  );
}
