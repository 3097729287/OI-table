import { useCallback, useEffect, useRef, useState } from "react";
import { messages } from "../../../i18n";
import { StatusMessage } from "../../../shared/StatusMessage";
import { NumberInput } from "../../../shared/ui/Fields";
import type { WorkspaceViewOptions, WorkspaceViewProps } from "../../../workspace/views";
import { SettingsPage } from "../SettingsPage";
import { useSettingsForm } from "../useSettingsForm";

export const workspaceView = {
  title: messages.dataAndDiagnostics,
  icon: "submissions",
  section: "settings",
  order: 90,
} satisfies WorkspaceViewOptions;

const minLogSize = 1;
const maxLogSize = 100;
const saveDelay = 400;

function parseLogSize(value: string) {
  const size = Number(value);
  if (Number.isInteger(size) && size >= minLogSize && size <= maxLogSize) return size;
}

export default function DiagnosticsView({ title }: WorkspaceViewProps) {
  const form = useSettingsForm();
  const { settings, saveChanges } = form;
  const [logSizeDraft, setLogSizeDraft] = useState<string>();
  const latestEdit = useRef(0);
  const pendingSave = useRef<{ size: number; timer: number }>(undefined);
  const logSizeInvalid = logSizeDraft !== undefined && parseLogSize(logSizeDraft) === undefined;

  const flushLogSize = useCallback(() => {
    const pending = pendingSave.current;
    if (!pending) return;

    window.clearTimeout(pending.timer);
    pendingSave.current = undefined;
    const edit = latestEdit.current;
    void saveChanges({ logMaxSizeMib: pending.size }).then((saved) => {
      if (saved && edit === latestEdit.current) setLogSizeDraft(undefined);
    });
  }, [saveChanges]);

  useEffect(() => flushLogSize, [flushLogSize]);

  function changeLogSize(value: string) {
    latestEdit.current += 1;
    setLogSizeDraft(value);
    window.clearTimeout(pendingSave.current?.timer);

    const size = parseLogSize(value);
    pendingSave.current = size === undefined ? undefined : {
      size,
      timer: window.setTimeout(flushLogSize, saveDelay),
    };
  }

  return (
    <SettingsPage title={title} form={form}>
      {settings && (
        <section className="log-settings" aria-labelledby="log-settings-heading">
          <h2 id="log-settings-heading">{messages.localLogs}</h2>
          <form className="settings-row" noValidate onSubmit={(event) => {
            event.preventDefault();
            flushLogSize();
          }}>
            <label htmlFor="log-max-size">{messages.logMaxSizeMib}</label>
            <NumberInput
              id="log-max-size"
              min={minLogSize}
              max={maxLogSize}
              step={1}
              required
              value={logSizeDraft ?? settings.logMaxSizeMib}
              aria-invalid={logSizeInvalid || undefined}
              aria-describedby={logSizeInvalid ? "log-retention log-size-error" : "log-retention"}
              onChange={(event) => changeLogSize(event.currentTarget.value)}
              onBlur={flushLogSize}
            />
          </form>
          <p id="log-retention" className="settings-hint">{messages.logRetention}</p>
          {logSizeInvalid && (
            <div id="log-size-error">
              <StatusMessage state="error">{messages.logSizeInvalid}</StatusMessage>
            </div>
          )}
        </section>
      )}
    </SettingsPage>
  );
}
