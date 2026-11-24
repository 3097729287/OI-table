import type { ComponentType } from "react";
import { useMessages } from "../../i18n";
import type { AppSettings } from "../../shared/settings";
import type { WorkspaceViewOptions, WorkspaceViewProps, WorkspaceViewVariant } from "../../workspace/views";
import AppearanceSection from "./appearance/section";
import DiagnosticsSection from "./diagnostics/section";
import EditorSection from "./editor/section";
import RunDebugSection from "./run-debug/section";
import { SettingsPage } from "./SettingsPage";
import { useSettingsForm } from "./useSettingsForm";

export type SettingsSectionProps = Pick<ReturnType<typeof useSettingsForm>, "saving" | "saveChanges"> & {
  settings: AppSettings;
};

type SettingsGroup = WorkspaceViewVariant & {
  params: { group: string };
  Section: ComponentType<SettingsSectionProps>;
};

export const workspaceView = {
  id: "settings",
  title: "settings",
  icon: "settings",
  section: "settings",
  order: 60,
  singleton: true,
  sidebarTitle: false,
  variants: [
    { params: { group: "appearance" }, title: "appearance", icon: "settings", Section: AppearanceSection },
    { params: { group: "editor" }, title: "editor", icon: "editor", Section: EditorSection },
    { params: { group: "run-debug" }, title: "runAndDebug", icon: "run", Section: RunDebugSection },
    { params: { group: "diagnostics" }, title: "dataAndDiagnostics", icon: "submissions", Section: DiagnosticsSection },
  ],
} satisfies WorkspaceViewOptions<SettingsGroup>;

export default function SettingsView({ params }: WorkspaceViewProps) {
  const messages = useMessages();
  const form = useSettingsForm();
  const { settings, saving, saveChanges } = form;
  const groups = workspaceView.variants;
  const group = groups.find((entry) => entry.params.group === params.group) ?? groups[0];
  const { Section, title } = group;

  return (
    <SettingsPage title={messages[title]} form={form}>
      {settings && <Section key={group.params.group} settings={settings} saving={saving} saveChanges={saveChanges} />}
    </SettingsPage>
  );
}
