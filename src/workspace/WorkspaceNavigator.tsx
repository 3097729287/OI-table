import { useContext, useState } from "react";
import { useMessages } from "../i18n";
import { Icon } from "../shared/Icon";
import { ScrollArea } from "../shared/ui/ScrollArea";
import { ProblemDebugPanel } from "../features/problem/ProblemDebugPanel";
import type { LocalDebug, ProblemDebugLaunch } from "../features/problem/localDebug";
import type { WorkspaceTarget } from "./layout";
import { WorkspaceSidebar } from "./sidebar";
import { WorkspaceMenu } from "./WorkspaceMenu";
import { workspaceSections, type WorkspaceSection } from "./views";

const railIconSize = 24;

export function WorkspaceNavigator({ showDebug, onShowDebug, onOpen, debug, debugLaunch }: {
  showDebug: boolean;
  onShowDebug: (visible: boolean) => void;
  onOpen: (target: WorkspaceTarget) => void;
  debug?: LocalDebug;
  debugLaunch?: ProblemDebugLaunch;
}) {
  const messages = useMessages();
  const sidebar = useContext(WorkspaceSidebar);
  const [menuSection, setMenuSection] = useState<Exclude<WorkspaceSection, "debug">>("catalog");
  const section = showDebug ? "debug" : menuSection;
  const [visitedSections, setVisitedSections] = useState<WorkspaceSection[]>([section]);
  if (!visitedSections.includes(section)) setVisitedSections([...visitedSections, section]);

  return (
    <>
      <ScrollArea as="aside" className="workspace-rail" orientation="vertical">
        <nav aria-label={messages.workspaceCategories}>
          {Object.entries(workspaceSections).map(([id, item]) => (
            <button key={id} type="button" title={messages[item.title]} aria-label={messages[item.title]}
              aria-controls="workspace-sidebar" aria-pressed={sidebar.visible && section === id}
              onClick={() => {
                const selected = id as WorkspaceSection;
                if (sidebar.visible && section === selected) {
                  sidebar.toggle();
                  return;
                }
                if (selected !== "debug") setMenuSection(selected);
                onShowDebug(selected === "debug");
                sidebar.show();
              }}>
              <Icon name={item.icon} size={railIconSize} />
            </button>
          ))}
        </nav>
      </ScrollArea>
      <aside id="workspace-sidebar" className="workbench-sidebar" hidden={!sidebar.visible}>
        {visitedSections.map((id) => (
          <ScrollArea key={id} hidden={id !== section}>
            {id === "debug" ? <ProblemDebugPanel state={debug} launch={debugLaunch} />
              : <WorkspaceMenu section={id} onOpen={onOpen} />}
          </ScrollArea>
        ))}
      </aside>
    </>
  );
}
