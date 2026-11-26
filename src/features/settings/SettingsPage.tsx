import type { ReactNode } from "react";
import { useMessages } from "../../i18n";
import { StatusMessage } from "../../shared/StatusMessage";
import type { useSettingsForm } from "./useSettingsForm";
import "./settings.css";

interface SettingsPageProps {
  title: string;
  children: ReactNode;
  form?: Pick<ReturnType<typeof useSettingsForm>, "settings" | "loadFailed" | "saveFailed">;
}

export function SettingsPage({ title, children, form }: SettingsPageProps) {
  const messages = useMessages();
  return (
    <section className="workspace workbench-page settings-view">
      <h1>{title}</h1>
      {children}
      {form && !form.settings && !form.loadFailed && (
        <StatusMessage state="loading">{messages.settingsLoading}</StatusMessage>
      )}
      {form?.loadFailed && <StatusMessage state="error">{messages.settingsLoadFailed}</StatusMessage>}
      {form?.saveFailed && <StatusMessage state="error">{messages.settingsSaveFailed}</StatusMessage>}
    </section>
  );
}
