import type { ReactElement } from 'react';
import { formatSubmittedAt } from './application-presentation';
import type { ReviewHistoryEntry, ReviewHistoryEventKind } from './types';

const EVENT_LABELS: Readonly<Record<ReviewHistoryEventKind, string>> = {
  SUBMITTED: '제출',
  RESUBMITTED: '재제출',
  APPROVED: '승인',
  REJECTED: '반려',
  REVERTED: '검토 대기로 되돌림',
};

export function ReviewHistoryTimeline({
  entries,
}: {
  readonly entries: readonly ReviewHistoryEntry[];
}): ReactElement {
  if (entries.length === 0) {
    return (
      <p className="text-body text-muted-foreground [word-break:keep-all]">
        아직 기록된 검토 이력이 없습니다.
      </p>
    );
  }

  return (
    <ol className="grid gap-3">
      {entries.map((entry) => (
        <li key={entry.id} className="grid gap-1 border-l-2 border-border pl-3">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-medium">{EVENT_LABELS[entry.eventKind]}</span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {formatSubmittedAt(entry.occurredAt)}
            </span>
            <span className="text-xs text-muted-foreground">
              {entry.actor.name ?? entry.actor.nickname} (@
              {entry.actor.nickname})
            </span>

            <span className="text-xs tabular-nums text-muted-foreground">
              {entry.revision}차
            </span>
          </div>
          {entry.rejectionReason !== null ? (
            <p className="text-small break-keep text-muted-foreground [overflow-wrap:anywhere]">
              {entry.rejectionReason}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
