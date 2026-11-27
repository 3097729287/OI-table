import type { ReactNode } from "react";
import { t } from "../../i18n";
import { StatusMessage } from "../../shared/StatusMessage";
import type { useSettingsForm } from "./useSettingsForm";
import "./settings.css";

interface SettingsPageProps {
  title: string;
  children: ReactNode;
  form?: Pick<ReturnType<typeof useSettingsForm>, "settings" | "loadFailed" | "saveFailed">;
}

export function SettingsPage({ title, children, form }: SettingsPageProps) {
  return (
    <section className="workspace workbench-page settings-view">
      <h1>{title}</h1>
      {children}
      {form && !form.settings && !form.loadFailed && (
        <StatusMessage state="loading">{t("settingsLoading")}</StatusMessage>
      )}
      {form?.loadFailed && <StatusMessage state="error">{t("settingsLoadFailed")}</StatusMessage>}
      {form?.saveFailed && <StatusMessage state="error">{t("settingsSaveFailed")}</StatusMessage>}
    </section>
  );
}
