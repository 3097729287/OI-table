import { useState, type ReactNode } from "react";
import { useMessages } from "../i18n";

interface SidebarDisclosureProps {
  id: string;
  expanded: boolean;
  loading?: boolean;
  children: ReactNode;
}

export function SidebarDisclosure({ id, expanded, loading = false, children }: SidebarDisclosureProps) {
  const messages = useMessages();
  const [hasExpanded, setHasExpanded] = useState(expanded);
  if (expanded && !hasExpanded) setHasExpanded(true);

  const busy = expanded && loading;
  const visible = expanded && !loading;

  return (
    <>
      <div id={id} className="workbench-sidebar__disclosure" data-visible={visible || undefined}
        aria-busy={busy || undefined} aria-hidden={!visible || undefined} inert={!visible}>
        <div className="workbench-sidebar__disclosure-content">
          {hasExpanded && children}
        </div>
      </div>
      <span className="workbench-sidebar__disclosure-status" role="status">
        {busy ? messages.libraryNavigationLoading : null}
      </span>
    </>
  );
}
