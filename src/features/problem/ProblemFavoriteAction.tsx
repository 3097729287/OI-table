import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { t } from "../../i18n";
import { Icon } from "../../shared/Icon";
import {
  collectionName, getPersonalMemberships, getPersonalRevision, setPersonalMembership, usePersonalCollections, usePersonalRevision,
} from "../../shared/personalCollections";
import { StatusMessage } from "../../shared/StatusMessage";
import { Popover } from "../../shared/ui/Popover";
import { ScrollArea } from "../../shared/ui/ScrollArea";
import { PersonalCollectionDialog } from "../personal/PersonalCollectionDialog";
import "./problem-collections.css";

export function ProblemFavoriteAction({ problemId }: { problemId: string }) {
  const revision = usePersonalRevision();
  const writing = useRef(false);
  const [favoriteIds, setFavoriteIds] = useState<string[]>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

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

  async function setIncluded(id: string, included: boolean) {
    if (writing.current) return;
    writing.current = true;
    setPending(true);
    setSaveFailed(false);
    try {
      await setPersonalMembership(id, problemId, included);
      setFavoriteIds((current) => current && (included ? [...new Set([...current, id])] : current.filter((value) => value !== id)));
    } catch {
      setSaveFailed(true);
    } finally {
      writing.current = false;
      setPending(false);
    }
  }

  const assigned = Boolean(favoriteIds?.length);
  return (
    <Popover label={t("personalProblemFavorite")} className="problem-collections-popover"
      trigger={<Icon name={assigned ? "favoriteFilled" : "favorites"} />}
      triggerProps={{
        className: "ui-icon-button problem-collection-action",
        title: t("personalProblemFavorite"),
        "aria-description": assigned ? t("personalProblemFavorited") : undefined,
        "data-assigned": assigned || undefined,
      }}>
      {(popoverId) => <FavoriteGroups popoverId={popoverId} favoriteIds={favoriteIds} loadFailed={loadFailed}
          pending={pending} saveFailed={saveFailed} onChange={setIncluded}
          retry={() => { setLoadFailed(false); setAttempt((count) => count + 1); }} />}
    </Popover>
  );
}

function FavoriteGroups({ popoverId, favoriteIds, loadFailed, pending, saveFailed, retry, onChange }: {
  popoverId: string;
  favoriteIds?: string[];
  loadFailed: boolean;
  pending: boolean;
  saveFailed: boolean;
  retry(): void;
  onChange(id: string, included: boolean): void;
}) {
  const createButton = useRef<HTMLButtonElement>(null);
  const restoreCreateFocus = useRef(false);
  const [creating, setCreating] = useState(false);
  const { collections, failed, retry: retryCollections } = usePersonalCollections();

  useLayoutEffect(() => {
    if (!creating && restoreCreateFocus.current) {
      restoreCreateFocus.current = false;
      createButton.current?.focus({ preventScroll: true });
    }
  }, [creating]);

  if (creating) {
    return <PersonalCollectionDialog inlineHeader={({ onBack, busy }) => (
      <FavoritePopoverHeader popoverId={popoverId} onBack={onBack} busy={busy} />
    )} onClose={() => {
      restoreCreateFocus.current = true;
      setCreating(false);
    }} />;
  }

  return (
    <>
      <FavoritePopoverHeader popoverId={popoverId} />
      <ScrollArea className="problem-collections-popover__body" orientation="vertical">
        {failed || loadFailed ? (
          <div className="problem-collections-popover__error">
            <StatusMessage state="error">{t("personalCollectionLoadFailed")}</StatusMessage>
            <button type="button" className="ui-field" onClick={() => { if (failed) retryCollections(); if (loadFailed) retry(); }}>
              {t("retry")}
            </button>
          </div>
        ) : !collections || !favoriteIds ? <StatusMessage state="loading">{t("libraryNavigationLoading")}</StatusMessage>
          : collections.length === 0 ? <StatusMessage state="empty">{t("personalCollectionEmpty")}</StatusMessage>
          : (
            <ul className="problem-collections-popover__items" aria-busy={pending || undefined}>
              {collections.map((item) => (
                <li key={item.id}>
                  <label className="problem-collections-popover__item">
                    <span className="problem-collections-popover__checkbox">
                      <input type="checkbox" checked={favoriteIds.includes(item.id)} aria-disabled={pending || undefined}
                        onChange={(event) => onChange(item.id, event.target.checked)} />
                      <span className="problem-collections-popover__checkmark" aria-hidden="true">
                        <Icon name="check" size={14} />
                      </span>
                    </span>
                    <span className="problem-collections-popover__label">{collectionName(item)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
      </ScrollArea>
      {saveFailed && <StatusMessage state="error">{t("personalMembershipSaveFailed")}</StatusMessage>}
      <footer className="problem-collections-popover__footer">
        <button ref={createButton} type="button" className="problem-collections-popover__create" disabled={!collections || pending}
          onClick={() => setCreating(true)}><Icon name="plus" size={14} />{t("personalCreateFavorite")}</button>
      </footer>
    </>
  );
}

function FavoritePopoverHeader({ popoverId, onBack, busy }: { popoverId: string; onBack?: () => void; busy?: boolean }) {
  const action = onBack ? t("personalCollectionBack") : t("close");
  return (
    <header className="problem-collections-popover__header">
      <h2>{t("personalProblemFavorite")}</h2>
      <button type="button" className="ui-icon-button" aria-label={action} title={action}
        popoverTarget={onBack ? undefined : popoverId} popoverTargetAction={onBack ? undefined : "hide"}
        onClick={onBack} disabled={busy}><Icon name={onBack ? "arrowLeft" : "close"} size={14} /></button>
    </header>
  );
}
