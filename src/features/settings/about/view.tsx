import { lazy, Suspense } from "react";
import type { WorkspaceViewOptions, WorkspaceViewProps } from "../../../workspace/views";
import { SettingsPage } from "../SettingsPage";

const AboutSection = lazy(() => import("./section"));

export const workspaceView = {
  id: "about",
  title: "about",
  icon: "catalog",
  singleton: true,
} satisfies WorkspaceViewOptions;

export default function AboutView({ title }: WorkspaceViewProps) {
  return (
    <SettingsPage title={title}>
      <Suspense fallback={null}>
        <AboutSection />
      </Suspense>
    </SettingsPage>
  );
}
