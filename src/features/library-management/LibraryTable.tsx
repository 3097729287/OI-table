import { useContext, useId } from "react";
import { LocaleContext, getMessages } from "../../i18n";
import { localizedLibraryText, type ProblemLibrary } from "../../shared/problemLibrary";
import "../../shared/ui/fields.css";

interface LibraryTableProps {
  libraries: readonly ProblemLibrary[];
  pending?: { libraryId: string; action: "enable" | "disable" | "uninstall" };
  onSetEnabled(library: ProblemLibrary, enabled: boolean): void;
  onUninstall(library: ProblemLibrary): void;
}

export function LibraryTable({ libraries, pending, onSetEnabled, onUninstall }: LibraryTableProps) {
  const locale = useContext(LocaleContext);
  const messages = getMessages(locale);
  const formatCount = new Intl.NumberFormat(locale);
  const idPrefix = useId();
  const statusLabels = {
    enabled: messages.libraryManagementEnabled,
    disabled: messages.libraryManagementDisabled,
    uninstalled: messages.libraryManagementUninstalled,
  };
  const pendingLabels = {
    enable: messages.libraryManagementEnabling,
    disable: messages.libraryManagementDisabling,
    uninstall: messages.libraryManagementUninstalling,
  };

  return (
    <table className="library-management__table" role="table">
      <thead role="rowgroup">
        <tr role="row">
          <th scope="col" role="columnheader">{messages.libraryManagementColumnLibrary}</th>
          <th scope="col" className="library-management__organizer-cell" role="columnheader">{messages.libraryManagementColumnOrganizer}</th>
          <th scope="col" className="library-management__count-cell" role="columnheader">{messages.libraryManagementColumnProblemCount}</th>
          <th scope="col" className="library-management__status-cell" role="columnheader">{messages.libraryManagementColumnStatus}</th>
          <th scope="col" className="library-management__action-cell" role="columnheader">{messages.libraryManagementColumnActions}</th>
        </tr>
      </thead>
      <tbody role="rowgroup">
        {libraries.map((library, index) => {
          const name = localizedLibraryText(library.name, locale) || library.id;
          const organizer = (library.authorName && localizedLibraryText(library.authorName, locale)) || library.authorId;
          const nameId = `${idPrefix}-${index}`;
          const enabled = library.status === "enabled";
          const toggleAction = enabled ? "disable" : "enable";
          const toggleLabel = enabled ? messages.libraryManagementDisable : messages.libraryManagementEnable;
          const pendingAction = pending?.libraryId === library.id ? pending.action : undefined;
          const actionsDisabled = pending !== undefined;
          const toggling = pendingAction === toggleAction;
          const uninstalling = pendingAction === "uninstall";

          return (
            <tr key={library.id} className="library-management__row" role="row">
              <th scope="row" className="library-management__identity-cell" role="rowheader">
                <div className="library-management__identity" data-selectable>
                  <div className="library-management__name-line">
                    <span className="library-management__name" id={nameId}>{name}</span>{" "}
                    <span className="library-management__version"
                      title={messages.libraryManagementVersion.replace("{version}", String(library.releaseVersion))}>
                      v{library.releaseVersion}
                    </span>
                  </div>
                  {name !== library.id && <span className="library-management__id">{library.id}</span>}
                </div>
              </th>
              <td className="library-management__organizer-cell" role="cell">
                <span className="library-management__organizer-label" aria-hidden="true">{messages.libraryManagementColumnOrganizer}</span>
                <span className="library-management__organizer" data-selectable title={library.authorId}>
                  {organizer}
                </span>
              </td>
              <td className="library-management__count-cell" role="cell">
                <span className="library-management__count-label" aria-hidden="true">{messages.libraryManagementColumnProblemCount}</span>
                <span className="library-management__count">{formatCount.format(library.problemCount)}</span>
              </td>
              <td className="library-management__status-cell" role="cell">
                <span className="library-management__status" data-status={library.status}>
                  {statusLabels[library.status]}
                </span>
              </td>
              <td className="library-management__action-cell" role="cell">
                {library.status !== "uninstalled" && (
                  <div className="library-management__actions">
                    <button
                      type="button"
                      className="ui-field library-management__button"
                      data-variant="quiet"
                      aria-describedby={nameId}
                      aria-disabled={actionsDisabled || undefined}
                      aria-busy={toggling || undefined}
                      aria-label={toggling ? pendingLabels[toggleAction] : undefined}
                      onClick={() => { if (!actionsDisabled) onSetEnabled(library, !enabled); }}
                    >
                      {toggleLabel}
                    </button>
                    <button
                      type="button"
                      className="ui-field library-management__button"
                      data-variant="quiet"
                      data-action="uninstall"
                      aria-describedby={nameId}
                      aria-disabled={actionsDisabled || undefined}
                      aria-busy={uninstalling || undefined}
                      aria-label={uninstalling ? pendingLabels.uninstall : undefined}
                      onClick={() => { if (!actionsDisabled) onUninstall(library); }}
                    >
                      {messages.libraryManagementUninstall}
                    </button>
                  </div>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
