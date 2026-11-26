import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMessages } from "../../i18n";
import { Icon } from "../../shared/Icon";
import {
  collectionName, getPersonalMemberships, getPersonalRevision, setPersonalMembership, usePersonalCollections, usePersonalRevision,
} from "../../shared/personalCollections";
import { StatusMessage } from "../../shared/StatusMessage";
import { PersonalCollectionDialog } from "../personal/PersonalCollectionDialog";
import "../personal/personal-dialog.css";
import "./problem-collections.css";

export function ProblemFavoriteAction({ problemId }: { problemId: string }) {
  const messages = useMessages();
  const revision = usePersonalRevision();
  const [favoriteIds, setFavoriteIds] = useState<string[]>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void getPersonalMemberships(problemId).then(
      ({ favoriteIds }) => {
        if (!active || revision !== getPersonalRevision()) return;
        setFavoriteIds(favoriteIds);
        setLoadFailed(false);
      },
      () => {
        if (active && revision === getPersonalRevision()) setLoadFailed(true);
      },
    );
    return () => { active = false; };
  }, [problemId, revision, attempt]);

  function applyMembership(id: string, included: boolean) {
    setFavoriteIds((current) => current && (included ? [...new Set([...current, id])] : current.filter((value) => value !== id)));
  }

  return (
    <>
      <button type="button" className="ui-icon-button problem-collection-action"
        aria-label={messages.personalProblemFavorite} title={messages.personalProblemFavorite} aria-haspopup="dialog"
        data-assigned={Boolean(favoriteIds?.length) || undefined} onClick={() => setOpen(true)}>
        <Icon name="favorites" />
      </button>
      {open && (
        <ProblemMembershipDialog problemId={problemId} favoriteIds={favoriteIds} loadFailed={loadFailed}
          onApplied={applyMembership} onClose={() => setOpen(false)}
          retry={() => { setLoadFailed(false); setAttempt((count) => count + 1); }} />
      )}
    </>
  );
}

function ProblemMembershipDialog({ problemId, favoriteIds, loadFailed, retry, onApplied, onClose }: {
  problemId: string;
  favoriteIds?: string[];
  loadFailed: boolean;
  retry(): void;
  onApplied(id: string, included: boolean): void;
  onClose(): void;
}) {
  const messages = useMessages();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const writing = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [creating, setCreating] = useState(false);
  const { collections, failed, retry: retryCollections } = usePersonalCollections();

  useLayoutEffect(() => {
    if (creating) return;
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, [creating]);

  async function setIncluded(id: string, included: boolean) {
    if (writing.current) return;
    writing.current = true;
    setPending(true);
    setError(false);
    try {
      await setPersonalMembership(id, problemId, included);
      onApplied(id, included);
    } catch {
      setError(true);
    } finally {
      writing.current = false;
      setPending(false);
    }
  }

  function close() {
    if (!writing.current) onClose();
  }

  if (creating) {
    return <PersonalCollectionDialog onClose={() => setCreating(false)} />;
  }

  return createPortal(
    <dialog ref={dialog} className="personal-dialog problem-collections-dialog" aria-labelledby={titleId} onCancel={(event) => {
      event.preventDefault();
      close();
    }}>
      <header className="personal-dialog__header">
        <h2 id={titleId}>{messages.personalProblemFavorite}</h2>
        <button type="button" className="ui-icon-button" aria-label={messages.close} title={messages.close}
          aria-disabled={pending || undefined} onClick={close}><Icon name="close" size={14} /></button>
      </header>
      <div className="personal-dialog__body">
        {failed || loadFailed ? (
          <div className="problem-collections-dialog__error">
            <StatusMessage state="error">{messages.personalCollectionLoadFailed}</StatusMessage>
            <button type="button" className="ui-field" onClick={() => { if (failed) retryCollections(); if (loadFailed) retry(); }}>
              {messages.retry}
            </button>
          </div>
        ) : !collections || !favoriteIds ? <StatusMessage state="loading">{messages.libraryNavigationLoading}</StatusMessage>
          : collections.length === 0 ? <StatusMessage state="empty">{messages.personalCollectionEmpty}</StatusMessage>
          : (
            <ul className="problem-collections-dialog__items" aria-busy={pending || undefined}>
              {collections.map((item) => (
                <li key={item.id}>
                  <label className="problem-collections-dialog__item">
                    <input type="checkbox" checked={favoriteIds.includes(item.id)} aria-disabled={pending || undefined}
                      onChange={(event) => void setIncluded(item.id, event.target.checked)} />
                    <span className="problem-collections-dialog__label">{collectionName(item, messages)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        {error && <StatusMessage state="error">{messages.personalMembershipSaveFailed}</StatusMessage>}
      </div>
      <footer className="personal-dialog__footer">
        <button type="button" className="ui-field personal-dialog__button" disabled={!collections || pending}
          onClick={() => setCreating(true)}>{messages.personalCreateFavorite}</button>
      </footer>
    </dialog>, document.body,
  );
}
