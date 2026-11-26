import { lazy, Suspense, type ComponentType } from "react";
import { useMessages } from "../../i18n";
import type { AppSettings } from "../../shared/settings";
import { DelayedLoadingMessage } from "../../shared/StatusMessage";
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

type SettingsGroup = WorkspaceViewVariant & { params: { group: string } } &
  ({ Section: ComponentType<SettingsSectionProps> } | { Page: ComponentType });

const AboutSection = lazy(() => import("./about/section"));

export const workspaceView = {
  id: "settings",
  title: "settings",
  icon: "settings",
  section: "settings",
  order: 60,
  singleton: true,
  sidebarTitle: false,
  sidebarGroups: [{ id: "settings", title: "settings" }],
  variants: [
    { params: { group: "appearance" }, title: "appearance", icon: "settings", Section: AppearanceSection },
    { params: { group: "editor" }, title: "editor", icon: "editor", Section: EditorSection },
    { params: { group: "run-debug" }, title: "runAndDebug", icon: "run", Section: RunDebugSection },
    { params: { group: "diagnostics" }, title: "dataAndDiagnostics", icon: "submissions", Section: DiagnosticsSection },
    { params: { group: "about" }, title: "about", icon: "catalog", Page: AboutSection,
      sidebarGroups: [{ id: "other", title: "settingsOther" }] },
  ],
} satisfies WorkspaceViewOptions<SettingsGroup>;

export default function SettingsView({ params }: WorkspaceViewProps) {
  const messages = useMessages();
  const form = useSettingsForm();
  const { settings, saving, saveChanges } = form;
  const groups = workspaceView.variants;
  const group = groups.find((entry) => entry.params.group === params.group) ?? groups[0];
  if (group.Page) {
    const Page = group.Page;
    return (
      <SettingsPage title={messages[group.title]}>
        <Suspense fallback={<DelayedLoadingMessage>{messages.settingsLoading}</DelayedLoadingMessage>}>
          <Page />
        </Suspense>
      </SettingsPage>
    );
  }
  const { Section, title } = group;

  return (
    <SettingsPage title={messages[title]} form={form}>
      {settings && <Section key={group.params.group} settings={settings} saving={saving} saveChanges={saveChanges} />}
    </SettingsPage>
  );
}
