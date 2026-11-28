import { useLayoutEffect, useRef, useState } from "react";
import { t } from "../../../i18n";
import { configurableCommandIds, commands, type ConfigurableCommandId } from "../../../shared/commands";
import { formatShortcut, registerShortcutRecorder, shortcutFor } from "../../../shared/keybindings";
import { StatusMessage } from "../../../shared/StatusMessage";
import { Input } from "../../../shared/ui/Fields";
import type { SettingsSectionProps } from "../view";

type Conflict = { command: ConfigurableCommandId; other: ConfigurableCommandId; shortcut: string };

export default function ShortcutsSection({ settings, saving, saveChanges }: SettingsSectionProps) {
  const [recording, setRecording] = useState<ConfigurableCommandId>();
  const [conflict, setConflict] = useState<Conflict>();
  const recordingArea = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const recordButtons = useRef<Partial<Record<ConfigurableCommandId, HTMLButtonElement | null>>>({});
  const overrides = settings.keybindings;

  function endRecording(restoreFocus = false) {
    setRecording(undefined);
    if (recording && restoreFocus) {
      window.requestAnimationFrame(() => recordButtons.current[recording]?.focus({ preventScroll: true }));
    }
  }

  function save(id: ConfigurableCommandId, shortcut: string | null | undefined, replace?: ConfigurableCommandId) {
    const keybindings = { ...overrides };
    if (shortcut === undefined) delete keybindings[id];
    else keybindings[id] = shortcut;
    if (replace) keybindings[replace] = null;
    setConflict(undefined);
    void saveChanges({ keybindings });
  }

  useLayoutEffect(() => {
    const area = recordingArea.current;
    const input = field.current;
    if (!recording || !area || !input) return;
    return registerShortcutRecorder(area, input, (shortcut) => {
      endRecording(true);
      if (shortcut === undefined) return;
      const other = configurableCommandIds.find((candidate) => candidate !== recording &&
        commands[candidate].scope === commands[recording].scope && shortcutFor(candidate, overrides) === shortcut);
      if (other) setConflict({ command: recording, other, shortcut });
      else save(recording, shortcut === shortcutFor(recording) ? undefined : shortcut);
    });
  });

  useLayoutEffect(() => {
    if (recording) field.current?.focus({ preventScroll: true });
  }, [recording]);

  return (
    <>
      {configurableCommandIds.map((id) => {
        const label = t(commands[id].label);
        const shortcut = shortcutFor(id, overrides);
        return (
          <div className="settings-row" key={id} role="group" aria-label={label}>
            <span>{label}</span>
            <div className="settings-shortcut-actions" ref={recording === id ? recordingArea : undefined} onBlur={(event) => {
              if (recording === id && !event.currentTarget.contains(event.relatedTarget)) endRecording();
            }}>
              {recording === id ? (
                <>
                  <Input ref={field} readOnly value="" placeholder={t("shortcutPressKeys")}
                    aria-label={t("shortcutRecordFor", { command: label })} />
                  <button type="button" className="ui-field" onClick={() => endRecording(true)}>{t("libraryManagementCancel")}</button>
                </>
              ) : (
                <>
                  {shortcut ? <kbd>{formatShortcut(shortcut)}</kbd> : <span>{t("shortcutDisabled")}</span>}
                  <button type="button" className="ui-field" ref={(button) => { recordButtons.current[id] = button; }}
                    disabled={saving || recording !== undefined} onClick={() => {
                    setConflict(undefined);
                    setRecording(id);
                  }}>{t("shortcutRecord")}</button>
                  <button type="button" className="ui-field" disabled={saving || recording !== undefined || shortcut === null}
                    onClick={() => save(id, null)}>{t("shortcutDisable")}</button>
                  <button type="button" className="ui-field" disabled={saving || recording !== undefined || overrides?.[id] === undefined}
                    onClick={() => save(id, undefined)}>{t("shortcutRestoreDefault")}</button>
                </>
              )}
            </div>
          </div>
        );
      })}
      {conflict && (
        <div className="settings-shortcut-actions">
          <StatusMessage state="error">{t("shortcutConflict", { command: t(commands[conflict.other].label) })}</StatusMessage>
          <button type="button" className="ui-field" disabled={saving}
            onClick={() => save(conflict.command, conflict.shortcut, conflict.other)}>{t("shortcutReplace")}</button>
          <button type="button" className="ui-field" onClick={() => setConflict(undefined)}>{t("libraryManagementCancel")}</button>
        </div>
      )}
    </>
  );
}
