import type { ReactElement } from 'react';
import { formatSubmittedAt } from './application-presentation';
import type { ReviewHistoryEntry, ReviewHistoryEventKind } from './types';

/**
 * 검토 이력 타임라인. 서버가 **최신순으로** 준 배열을 그대로 그린다 — 화면이 다시
 * 정렬하지 않는다. 페이지 경계가 없는 단건 조회라 순서를 화면이 손대면 서버와
 * 어긋나기만 한다.
 */
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
    // 제출 사건이 항상 남으므로 실제로는 비지 않는다. 그래도 빈 배열을 조용한
    // 빈 화면으로 두지 않는다 — 없는 것은 없다고 말한다.
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
            {/* 회차는 「몇 번째 신청서인가」다 — 이력 줄 번호가 아니다. */}
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
