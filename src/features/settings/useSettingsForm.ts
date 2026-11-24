import { useState } from "react";
import { updateSettings, useSettings, type AppSettings } from "../../shared/settings";

export function useSettingsForm() {
  const { settings, loadFailed } = useSettings();
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  async function saveChanges(changes: Partial<AppSettings>) {
    setSaving(true);
    setSaveFailed(false);
    try {
      await updateSettings(changes);
      return true;
    } catch {
      setSaveFailed(true);
      return false;
    } finally {
      setSaving(false);
    }
  }

  return { settings, loadFailed, saving, saveFailed, saveChanges };
}
