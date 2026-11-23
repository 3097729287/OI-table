import { useContext, useState } from "react";
import { messages } from "../i18n";
import { Icon } from "../shared/Icon";
import { StatusMessage } from "../shared/StatusMessage";
import { desktop, openWindow } from "../windowing/routes";
import { WorkspaceSidebar } from "./sidebar";
import { WorkspaceMenu } from "./WorkspaceMenu";
import { workspaceSections, type WorkspaceSection } from "./views";

const railIconSize = 24;

export function WorkspaceNavigator({ onOpen }: { onOpen: (view: string) => void }) {
  const sidebar = useContext(WorkspaceSidebar);
  const [section, setSection] = useState<WorkspaceSection>("catalog");
  const [settingsState, setSettingsState] = useState<"idle" | "opening" | "error">("idle");

  async function openSettings() {
    setSettingsState("opening");
    try {
      await openWindow("settings");
      setSettingsState("idle");
    } catch {
      setSettingsState("error");
    }
  }

  return (
    <>
      <aside className="workspace-rail">
        <nav aria-label={messages.workspaceCategories}>
          {Object.entries(workspaceSections).map(([id, item]) => (
            <button key={id} type="button" title={item.title} aria-label={item.title}
              aria-controls="workspace-sidebar" aria-pressed={sidebar.visible && section === id}
              onClick={() => {
                setSection(id as WorkspaceSection);
                sidebar.show();
              }}>
              <Icon name={item.icon} size={railIconSize} />
            </button>
          ))}
        </nav>
        <button type="button" className="workspace-rail__settings" title={messages.settings}
          aria-label={messages.settings} disabled={!desktop || settingsState === "opening"}
          onClick={() => void openSettings()}>
          <Icon name="settings" size={railIconSize} />
        </button>
        {settingsState === "error" && (
          <div className="workspace-rail__feedback">
            <StatusMessage state="error">{messages.settingsOpenFailed}</StatusMessage>
          </div>
        )}
      </aside>
      <aside id="workspace-sidebar" className="workbench-sidebar" hidden={!sidebar.visible}>
        <WorkspaceMenu section={section} onOpen={onOpen} />
      </aside>
    </>
  );
}
