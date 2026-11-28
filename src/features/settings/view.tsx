import type { ComponentType } from "react";
import { t } from "../../i18n";
import type { AppSettings } from "../../shared/settings";
import type { WorkspaceViewOptions, WorkspaceViewProps, WorkspaceViewVariant } from "../../workspace/views";
import AppearanceSection from "./appearance/section";
import DiagnosticsSection from "./diagnostics/section";
import EditorSection from "./editor/section";
import RunDebugSection from "./run-debug/section";
import ShortcutsSection from "./shortcuts/section";
import { SettingsPage } from "./SettingsPage";
import { useSettingsForm } from "./useSettingsForm";

export type SettingsSectionProps = Pick<ReturnType<typeof useSettingsForm>, "saving" | "saveChanges"> & {
  settings: AppSettings;
};

type SettingsVariant = WorkspaceViewVariant & {
  params: { group: string };
  Section: ComponentType<SettingsSectionProps>;
};

export const workspaceView = {
  id: "settings",
  title: "settings",
  icon: "settings",
  singleton: true,
  variants: {
    appearance: { params: { group: "appearance" }, title: "appearance", icon: "appearance", Section: AppearanceSection },
    editor: { params: { group: "editor" }, title: "editor", icon: "editor", Section: EditorSection },
    shortcuts: { params: { group: "shortcuts" }, title: "shortcutSettings", Section: ShortcutsSection },
    runDebug: { params: { group: "run-debug" }, title: "runAndDebug", icon: "run", Section: RunDebugSection },
    diagnostics: { params: { group: "diagnostics" }, title: "dataAndDiagnostics", icon: "activity", Section: DiagnosticsSection },
  },
} satisfies WorkspaceViewOptions<SettingsVariant>;

export default function SettingsView({ params }: WorkspaceViewProps) {
  const form = useSettingsForm();
  const { settings, saving, saveChanges } = form;
  const { variants } = workspaceView;
  const variant = Object.values(variants).find((entry) => entry.params.group === params.group) ?? variants.appearance;
  const { Section, title } = variant;

  return (
    <SettingsPage title={t(title)} form={form}>
      {settings && <Section key={variant.params.group} settings={settings} saving={saving} saveChanges={saveChanges} />}
    </SettingsPage>
  );
}
