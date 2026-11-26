import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMessages, type MessageKey } from "../../i18n";
import { Icon } from "../../shared/Icon";
import { collectionName, deletePersonalCollection, savePersonalCollection, type PersonalCollection } from "../../shared/personalCollections";
import { Input } from "../../shared/ui/Fields";
import "./personal-dialog.css";

export interface PersonalCollectionDialogProps {
  current?: PersonalCollection;
  mode?: "edit" | "delete";
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

export function PersonalCollectionDialog({ current, mode = "edit", onClose, onSaved }: PersonalCollectionDialogProps) {
  const messages = useMessages();
  const dialog = useRef<HTMLDialogElement>(null);
  const inFlight = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const nameId = useId();
  const cancelId = useId();
  const [name, setName] = useState(current?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey>();
  const deleting = mode === "delete";
  const firstControl = deleting ? cancelId : nameId;
  const title = deleting ? messages.personalDelete : current ? messages.personalRename : messages.personalCreateFavorite;
  const canSubmit = !current?.builtin && (deleting ? current !== undefined : name.trim().length > 0);

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const trigger = document.activeElement;
    element.showModal();
    document.getElementById(firstControl)?.focus({ preventScroll: true });
    return () => {
      element.close();
      if (trigger instanceof HTMLElement && trigger.isConnected && document.activeElement === document.body) {
        trigger.focus({ preventScroll: true });
      }
    };
  }, [firstControl]);

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

  return createPortal(
    <dialog ref={dialog} className="personal-dialog" aria-labelledby={titleId}
      aria-describedby={deleting ? descriptionId : undefined}
      onCancel={(event) => { event.preventDefault(); close(); }}>
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <header className="personal-dialog__header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="ui-icon-button" aria-label={messages.close} title={messages.close}
            aria-disabled={busy || undefined} onClick={close}><Icon name="close" size={14} /></button>
        </header>
        <div className="personal-dialog__body">
          {deleting && current && (
            <p id={descriptionId} data-selectable>
              {messages.personalDeleteFavoriteDescription.replace("{name}", () => collectionName(current, messages))}
            </p>
          )}
          {!deleting && (
            <div className="personal-dialog__field">
              <label htmlFor={nameId}>{messages.personalCollectionName}</label>
              <Input id={nameId} value={name} readOnly={busy} required
                aria-invalid={error === "personalCollectionInvalidName" || undefined}
                onChange={(event) => { setName(event.target.value); setError(undefined); }} />
            </div>
          )}
          {error && <p className="personal-dialog__error" role="alert">{messages[error]}</p>}
        </div>
        <footer className="personal-dialog__footer">
          {busy && <span className="personal-dialog__status" role="status">
            {deleting ? messages.personalCollectionDeleting : messages.personalCollectionSaving}
          </span>}
          <button id={cancelId} type="button" className="ui-field personal-dialog__button"
            aria-disabled={busy || undefined} onClick={close}>{messages.libraryManagementCancel}</button>
          <button type="submit" className="ui-field personal-dialog__button" data-variant={deleting ? "danger" : "primary"}
            disabled={!canSubmit} aria-disabled={busy || undefined} aria-busy={busy || undefined}>
            {deleting ? messages.personalDelete : current ? messages.save : messages.personalCreate}
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}
