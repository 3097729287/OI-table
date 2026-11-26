import { useEffect, useState, type ReactNode } from "react";
import { useMessages } from "../i18n";
import { getLibraryRevision, useLibraryRevision } from "./problemLibrary";

export function useLibraryNavigationRows<Row>(load: () => Promise<Row[]>, expanded: boolean) {
  const revision = useLibraryRevision();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ revision: number; attempt: number; rows?: Row[]; failed: boolean }>();
  const settled = result?.revision === revision && result.attempt === attempt;

  useEffect(() => {
    if (!expanded || settled) return;

    let active = true;
    void load().then(
      (rows) => {
        if (active && revision === getLibraryRevision()) setResult({ revision, attempt, rows, failed: false });
      },
      () => {
        if (active && revision === getLibraryRevision()) {
          setResult((previous) => ({ revision, attempt, rows: previous?.rows, failed: true }));
        }
      },
    );
    return () => { active = false; };
  }, [attempt, expanded, load, revision, settled]);

  return {
    rows: result?.rows,
    loading: !settled && result?.rows === undefined,
    failed: settled && result.failed,
    retry: () => setAttempt((previous) => previous + 1),
  };
}

interface LibraryNavigationRowsProps<Row> {
  rows?: Row[];
  failed: boolean;
  retry: () => void;
  empty?: string;
  render: (row: Row) => ReactNode;
}

export function LibraryNavigationRows<Row>({ rows, failed, retry, empty, render }: LibraryNavigationRowsProps<Row>) {
  const messages = useMessages();
  return (
    <>
      {rows?.map(render)}
      {failed && <li><button type="button" onClick={retry}>{messages.libraryNavigationLoadFailed}</button></li>}
      {!failed && rows?.length === 0 && empty && <li className="workbench-sidebar__status">{empty}</li>}
    </>
  );
}
