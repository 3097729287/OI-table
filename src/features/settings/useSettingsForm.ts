import { useCallback, useRef, useState } from "react";
import { updateSettings, useSettings, type AppSettings } from "../../shared/settings";

export function useSettingsForm() {
  const { settings, loadFailed } = useSettings();
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const latestUpdate = useRef<Promise<void>>(undefined);

  const saveChanges = useCallback(async (changes: Partial<AppSettings>) => {
    setSaving(true);
    setSaveFailed(false);

    const update = updateSettings(changes);
    latestUpdate.current = update;

    try {
      await update;
      return true;
    } catch {
      if (latestUpdate.current === update) setSaveFailed(true);
      return false;
    } finally {
      if (latestUpdate.current === update) setSaving(false);
    }
  }, []);

  return { settings, loadFailed, saving, saveFailed, saveChanges };
}
