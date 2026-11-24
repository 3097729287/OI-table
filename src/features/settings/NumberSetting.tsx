import { useCallback, useEffect, useRef, useState } from "react";
import type { AppSettings } from "../../shared/settings";
import { StatusMessage } from "../../shared/StatusMessage";
import { NumberInput } from "../../shared/ui/Fields";

interface NumberSettingProps {
  id: string;
  setting: "logMaxSizeMib" | "uiFontSize";
  label: string;
  description?: string;
  invalidMessage: string;
  value: number;
  min: number;
  max: number;
  saveChanges: (changes: Partial<AppSettings>) => Promise<boolean>;
}

const saveDelay = 400;

export function NumberSetting({
  id, setting, label, description, invalidMessage, value, min, max, saveChanges,
}: NumberSettingProps) {
  const [draft, setDraft] = useState<string>();
  const latestEdit = useRef(0);
  const pendingSave = useRef<{ value: number; timer: number }>(undefined);
  const hintId = description ? `${id}-hint` : undefined;
  const errorId = `${id}-error`;

  function parseValue(raw: string) {
    const next = Number(raw);
    if (raw !== "" && Number.isInteger(next) && next >= min && next <= max) return next;
  }

  const invalid = draft !== undefined && parseValue(draft) === undefined;

  const flush = useCallback(() => {
    const pending = pendingSave.current;
    if (!pending) return;

    window.clearTimeout(pending.timer);
    pendingSave.current = undefined;
    const edit = latestEdit.current;
    void saveChanges({ [setting]: pending.value }).then((saved) => {
      if (saved && edit === latestEdit.current) setDraft(undefined);
    });
  }, [saveChanges, setting]);

  useEffect(() => flush, [flush]);

  function change(raw: string) {
    latestEdit.current += 1;
    setDraft(raw);
    window.clearTimeout(pendingSave.current?.timer);

    const next = parseValue(raw);
    pendingSave.current = next === undefined ? undefined : {
      value: next,
      timer: window.setTimeout(flush, saveDelay),
    };
  }

  return (
    <>
      <form className="settings-row" noValidate onSubmit={(event) => {
        event.preventDefault();
        flush();
      }}>
        <label htmlFor={id}>{label}</label>
        <NumberInput
          id={id}
          min={min}
          max={max}
          step={1}
          required
          value={draft ?? value}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? [hintId, errorId].filter(Boolean).join(" ") : hintId}
          onChange={(event) => change(event.currentTarget.value)}
          onBlur={flush}
        />
      </form>
      {description && <p id={hintId} className="settings-hint">{description}</p>}
      {invalid && <div id={errorId}><StatusMessage state="error">{invalidMessage}</StatusMessage></div>}
    </>
  );
}
