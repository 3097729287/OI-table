import { useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { t, type MessageKey } from "../../i18n";
import { Icon } from "../../shared/Icon";
import { collectionName, deletePersonalCollection, savePersonalCollection, type PersonalCollection } from "../../shared/personalCollections";
import { Input } from "../../shared/ui/Fields";
import "./personal-dialog.css";

export interface PersonalCollectionDialogProps {
  current?: PersonalCollection;
  mode?: "edit" | "delete";
  inlineHeader?: (props: { onBack(): void; busy: boolean }) => ReactNode;
  onClose: () => void;
  onSaved?: (collection: PersonalCollection) => void;
}

const collectionErrors = new Map<string, MessageKey>([
  ["personal_not_found", "personalCollectionMissing"],
  ["personal_invalid_name", "personalCollectionInvalidName"],
  ["personal_builtin", "personalCollectionBuiltin"],
]);

function errorMessage(error: unknown, fallback: MessageKey) {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" ? collectionErrors.get(code) ?? fallback : fallback;
}

export function PersonalCollectionDialog({ current, mode = "edit", inlineHeader, onClose, onSaved }: PersonalCollectionDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const inFlight = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const nameId = useId();
  const cancelId = useId();
  const [name, setName] = useState(current?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey>();
  const inline = inlineHeader !== undefined;
  const deleting = mode === "delete";
  const firstControl = deleting ? cancelId : nameId;
  const title = deleting ? t("personalDelete") : current ? t("personalRename") : t("personalCreateFavorite");
  const canSubmit = !current?.builtin && (deleting ? current !== undefined : name.trim().length > 0);

  useLayoutEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement;
    element?.showModal();
    document.getElementById(firstControl)?.focus({ preventScroll: true });
    return () => {
      element?.close();
      if (element && trigger instanceof HTMLElement && trigger.isConnected && document.activeElement === document.body) {
        trigger.focus({ preventScroll: true });
      }
    };
  }, [firstControl, inline]);

  function close() {
    if (!inFlight.current) onClose();
  }

  async function submit() {
    if (!canSubmit || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    let saved: PersonalCollection | undefined;
    try {
      if (deleting && current) await deletePersonalCollection(current.id);
      else saved = await savePersonalCollection({ id: current?.id, name: name.trim() });
    } catch (error) {
      setError(errorMessage(error, deleting ? "personalCollectionDeleteFailed" : "personalCollectionSaveFailed"));
      return;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }

    if (saved) onSaved?.(saved);
    onClose();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  const fieldName = t("personalCollectionName");
  const nameInput = (
    <Input id={nameId} value={name} readOnly={busy} required
      placeholder={inline ? fieldName : undefined} aria-label={inline ? fieldName : undefined}
      aria-invalid={error === "personalCollectionInvalidName" || undefined}
      onChange={(event) => { setName(event.target.value); setError(undefined); }} />
  );
  const feedback = error && <p className="personal-dialog__error" role="alert">{t(error)}</p>;

  if (inlineHeader) {
    return (
      <form className="personal-collection-inline" onSubmit={handleSubmit} aria-busy={busy || undefined}>
        {inlineHeader({ onBack: close, busy })}
        <div className="personal-collection-inline__body">
          <div className="personal-collection-inline__row">
            {nameInput}
            <button type="submit" className="ui-icon-button personal-collection-inline__submit"
              aria-label={t("personalCreate")} title={t("personalCreate")} disabled={!canSubmit || busy}>
              <Icon name="check" size={16} />
            </button>
          </div>
          {feedback}
          {busy && <p className="personal-dialog__status" role="status">{t("personalCollectionSaving")}</p>}
        </div>
      </form>
    );
  }

  const form = (
    <form onSubmit={handleSubmit}>
      <header className="personal-dialog__header">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="ui-icon-button" aria-label={t("close")} title={t("close")}
          aria-disabled={busy || undefined} onClick={close}><Icon name="close" size={14} /></button>
      </header>
      <div className="personal-dialog__body">
        {deleting && current && (
          <p id={descriptionId} data-selectable>
            {t("personalDeleteFavoriteDescription", { name: collectionName(current) })}
          </p>
        )}
        {!deleting && (
          <div className="personal-dialog__field">
            <label htmlFor={nameId}>{fieldName}</label>
            {nameInput}
          </div>
        )}
        {feedback}
      </div>
      <footer className="personal-dialog__footer">
        {busy && <span className="personal-dialog__status" role="status">
          {deleting ? t("personalCollectionDeleting") : t("personalCollectionSaving")}
        </span>}
        <button id={cancelId} type="button" className="ui-field personal-dialog__button"
          aria-disabled={busy || undefined} onClick={close}>{t("libraryManagementCancel")}</button>
        <button type="submit" className="ui-field personal-dialog__button" data-variant={deleting ? "danger" : "primary"}
          disabled={!canSubmit} aria-disabled={busy || undefined} aria-busy={busy || undefined}>
          {deleting ? t("personalDelete") : current ? t("save") : t("personalCreate")}
        </button>
      </footer>
    </form>
  );

  return createPortal(
    <dialog ref={dialog} className="personal-dialog" aria-labelledby={titleId}
      aria-describedby={deleting ? descriptionId : undefined}
      onCancel={(event) => { event.preventDefault(); close(); }}>
      {form}
    </dialog>,
    document.body,
  );
}
