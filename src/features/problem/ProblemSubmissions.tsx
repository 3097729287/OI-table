import { useContext, useEffect, useMemo, useState } from "react";
import { LocaleContext, useMessages, type MessageKey } from "../../i18n";
import { listProblemSubmissions, type ProblemSubmissionPage } from "../../shared/problemLibrary";
import { StatusMessage } from "../../shared/StatusMessage";
import { ScrollArea } from "../../shared/ui/ScrollArea";
import "../../shared/ui/fields.css";
import "./problem-submissions.css";

const verdictLabels = new Map<string, MessageKey>([
  ["accepted", "problemSubmissionAccepted"],
  ["wrong_answer", "problemSubmissionWrongAnswer"],
  ["time_limit_exceeded", "problemSubmissionTimeLimit"],
  ["memory_limit_exceeded", "problemSubmissionMemoryLimit"],
  ["runtime_error", "problemRunRuntimeError"],
  ["compile_error", "problemRunCompileError"],
]);

type Request = { after?: string };
type Result = ProblemSubmissionPage & { request: Request; failed: boolean };

function submissionTime(value: number) {
  // Existing records may use either Unix seconds or milliseconds.
  const milliseconds = Math.abs(value) < 100_000_000_000 ? value * 1_000 : value;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function submissionLanguage(language: string) {
  if (language === "cpp") return "C++";
  if (language === "python" || language === "py") return "Python";
  return language;
}

export function ProblemSubmissions({ problemId }: { problemId: string }) {
  const messages = useMessages();
  const locale = useContext(LocaleContext);
  const formatDate = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }), [locale]);
  const [request, setRequest] = useState<Request>({});
  const [result, setResult] = useState<Result>();
  const settled = result?.request === request ? result : undefined;
  const items = result?.items ?? [];

  useEffect(() => {
    let current = true;
    void listProblemSubmissions(problemId, request.after).then(
      (page) => {
        if (!current) return;
        setResult((previous) => ({
          request, failed: false, nextCursor: page.nextCursor,
          items: request.after && previous ? [...previous.items, ...page.items] : page.items,
        }));
      },
      () => {
        if (current) setResult((previous) => ({
          request, failed: true, items: previous?.items ?? [], nextCursor: previous?.nextCursor ?? null,
        }));
      },
    );
    return () => { current = false; };
  }, [problemId, request]);

  return (
    <ScrollArea className="problem-submissions" orientation="vertical" aria-busy={!settled}>
      <div className="problem-submissions__body">
        {items.length > 0 && (
          <ul className="problem-submissions__records" aria-label={messages.submissionHistory}>
            {items.map((item) => {
              const verdict = verdictLabels.get(item.status);
              const time = submissionTime(item.createdAt);
              return (
                <li key={item.id} className="problem-submissions__record" data-selectable>
                  <strong className="problem-submissions__verdict" data-accepted={item.status === "accepted"}>
                    {verdict ? messages[verdict] : item.status}
                  </strong>
                  {time && <time dateTime={time.toISOString()}>{formatDate.format(time)}</time>}
                  <div className="problem-submissions__metadata">
                    <span>{submissionLanguage(item.language)}</span>
                    <span>{messages.problemSubmissionVersion.replace("{version}", String(item.contentVersion))}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {!settled && <StatusMessage state="loading">{messages.problemSubmissionsLoading}</StatusMessage>}
        {settled?.failed && (
          <div className="problem-submissions__failure">
            <StatusMessage state="error">{messages.problemSubmissionsLoadFailed}</StatusMessage>
            <button type="button" className="ui-field problem-submissions__action" onClick={() => setRequest({ ...request })}>
              {messages.retry}
            </button>
          </div>
        )}
        {settled && !settled.failed && items.length === 0 && (
          <StatusMessage state="empty">{messages.problemSubmissionsEmpty}</StatusMessage>
        )}
        {settled && !settled.failed && settled.nextCursor && (
          <button type="button" className="ui-field problem-submissions__action"
            onClick={() => setRequest({ after: settled.nextCursor ?? undefined })}>{messages.problemSubmissionsMore}</button>
        )}
      </div>
    </ScrollArea>
  );
}
