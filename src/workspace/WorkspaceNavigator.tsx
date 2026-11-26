import { useContext, useState } from "react";
import { useMessages } from "../i18n";
import { Icon } from "../shared/Icon";
import { ScrollArea } from "../shared/ui/ScrollArea";
import type { WorkspaceTarget } from "./layout";
import { WorkspaceSidebar } from "./sidebar";
import { workspaceSections } from "./sidebarMenu";
import { WorkspaceMenu } from "./WorkspaceMenu";

const railIconSize = 24;

export function WorkspaceNavigator({ sectionId, onSelectSection, onOpen }: {
  sectionId?: string;
  onSelectSection: (id: string) => void;
  onOpen: (target: WorkspaceTarget) => void;
}) {
  const messages = useMessages();
  const sidebar = useContext(WorkspaceSidebar);
  const [visitedSections, setVisitedSections] = useState(() => sectionId ? [sectionId] : []);
  if (sectionId && !visitedSections.includes(sectionId)) setVisitedSections([...visitedSections, sectionId]);

  return (
    <>
      <ScrollArea as="aside" className="workspace-rail" orientation="vertical">
        <nav aria-label={messages.workspaceCategories}>
          {workspaceSections.map(({ id, title, icon }) => (
            <button key={id} type="button" title={messages[title]} aria-label={messages[title]}
              aria-controls="workspace-sidebar" aria-pressed={sidebar.visible && sectionId === id}
              onClick={() => {
                if (sidebar.visible && sectionId === id) {
                  sidebar.toggle();
                  return;
                }
                onSelectSection(id);
                sidebar.show();
              }}>
              <Icon name={icon} size={railIconSize} />
            </button>
          ))}
        </nav>
      </ScrollArea>
      <aside id="workspace-sidebar" className="workbench-sidebar" hidden={!sidebar.visible}>
        {workspaceSections.filter(({ id }) => visitedSections.includes(id)).map((section) => (
          <ScrollArea key={section.id} hidden={section.id !== sectionId}>
            {section.Panel ? <section.Panel /> : <WorkspaceMenu section={section} onOpen={onOpen} />}
          </ScrollArea>
        ))}
      </aside>
    </>
  );
}
