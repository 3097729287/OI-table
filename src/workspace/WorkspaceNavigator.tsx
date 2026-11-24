import { useContext, useState } from "react";
import { useMessages } from "../i18n";
import { Icon } from "../shared/Icon";
import { ScrollArea } from "../shared/ui/ScrollArea";
import type { WorkspaceTarget } from "./layout";
import { WorkspaceSidebar } from "./sidebar";
import { WorkspaceMenu } from "./WorkspaceMenu";
import { workspaceSections, type WorkspaceSection } from "./views";

const railIconSize = 24;

export function WorkspaceNavigator({ onOpen }: { onOpen: (target: WorkspaceTarget) => void }) {
  const messages = useMessages();
  const sidebar = useContext(WorkspaceSidebar);
  const [section, setSection] = useState<WorkspaceSection>("catalog");

  return (
    <>
      <ScrollArea as="aside" className="workspace-rail" orientation="vertical">
        <nav aria-label={messages.workspaceCategories}>
          {Object.entries(workspaceSections).map(([id, item]) => (
            <button key={id} type="button" title={messages[item.title]} aria-label={messages[item.title]}
              aria-controls="workspace-sidebar" aria-pressed={sidebar.visible && section === id}
              onClick={() => {
                setSection(id as WorkspaceSection);
                sidebar.show();
              }}>
              <Icon name={item.icon} size={railIconSize} />
            </button>
          ))}
        </nav>
      </ScrollArea>
      <ScrollArea as="aside" id="workspace-sidebar" className="workbench-sidebar" hidden={!sidebar.visible}>
        <WorkspaceMenu section={section} onOpen={onOpen} />
      </ScrollArea>
    </>
  );
}
