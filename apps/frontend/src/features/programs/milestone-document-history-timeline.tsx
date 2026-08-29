import { FileText } from 'lucide-react';
import { useId, type ReactElement } from 'react';
import type { MilestoneDocumentCollectionHistory } from './milestone-document-collection-api';
import { formatSeoulShortDateTime } from './program-detail-format';

const EVENT_LABELS = {
  SUBMITTED: '첫 제출',
  RESUBMITTED: '다시 제출',
  CHANGES_REQUESTED: '보완 요청',
  APPROVED: '승인',
  REJECTED: '반려',
} as const satisfies Record<
  MilestoneDocumentCollectionHistory['event'],
  string
>;

/**
 * 지금 가진 이력이 처음 제출까지 닿는지에 관한 화면 계약이다.
 *
 * cursor 페이지가 남아 있거나, 응답이 완전성을 보장하지 않으면 앞 제출본이 없다고
 * 단정할 수 없다. 서버가 나중에 더 강한 완전성 메타데이터를 주더라도 이 경계에서만
 * 그 값을 이 계약으로 바꾸면 된다.
 */
export type MilestoneDocumentHistoryCompleteness =
  'complete' | 'has-more' | 'incomplete';

export function MilestoneDocumentHistoryTimeline({
  history,
  completeness,
}: {
  readonly history: readonly MilestoneDocumentCollectionHistory[];
  readonly completeness: MilestoneDocumentHistoryCompleteness;
}): ReactElement | null {
  const titleId = useId();
  if (history.length === 0 && completeness !== 'incomplete') return null;
  const firstKnownSubmission = history.find(
    (item) => item.event === 'SUBMITTED' || item.event === 'RESUBMITTED',
  );
  const hasLegacyRevisionGap =
    completeness === 'complete' &&
    firstKnownSubmission?.revision !== null &&
    firstKnownSubmission?.revision !== undefined &&
    firstKnownSubmission.revision > 1;
  const keyedHistory = historyEntriesWithStableKeys(history);
  return (
    <section
      className="grid gap-3 rounded-card border border-border bg-card p-card"
      aria-labelledby={titleId}
    >
      <div className="grid gap-1">
        <h4 id={titleId} className="text-small font-semibold">
          제출·검토 이력
        </h4>
        <p className="text-small text-muted-foreground break-keep">
          제출과 검토를 시간순으로 확인합니다.
        </p>
        {hasLegacyRevisionGap ? (
          <p className="text-small text-muted-foreground break-keep">
            이관 전 1~{firstKnownSubmission.revision - 1}차 제출 원문은 당시
            시스템에 남지 않아 이 화면에서 확인할 수 없습니다. 검토에 필요하면
            프로그램 담당자에게 기존 접수 기록을 요청해 주세요.
          </p>
        ) : null}
        {completeness === 'incomplete' ? (
          <p className="text-small text-muted-foreground break-keep">
            이관 전 제출 이력 일부는 당시 시스템에 남지 않아 이 화면에서 확인할
            수 없습니다. 검토에 필요하면 프로그램 담당자에게 기존 접수 기록을
            요청해 주세요.
          </p>
        ) : null}
      </div>
      <ol className="grid gap-3">
        {keyedHistory.map(({ item, key }, index) => (
          <li key={key} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-3">
            <span
              className="mt-1 grid size-6 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
              aria-hidden="true"
            >
              {index + 1}
            </span>
            <div className="grid gap-1 border-b border-border pb-3 last:border-0">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small">
                <strong>
                  {EVENT_LABELS[item.event]}
                  {item.revision === null ? '' : ` · ${item.revision}차 제출본`}
                </strong>
                <span className="text-muted-foreground">
                  {item.actorNickname} ·{' '}
                  {formatSeoulShortDateTime(item.createdAt)}
                </span>
              </p>
              {item.fileName === null ? null : (
                <p className="flex min-w-0 items-center gap-2 text-small">
                  <FileText className="size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate" title={item.fileName}>
                    {item.fileName}
                  </span>
                </p>
              )}
              {item.content == null ? null : (
                <p className="text-small break-keep whitespace-pre-wrap">
                  {item.content.text}
                </p>
              )}
              {item.comment === null ? null : (
                <p className="text-small break-keep whitespace-pre-wrap">
                  {item.comment}
                </p>
              )}
              {isReview(item) && item.revision === null ? (
                <p className="text-small text-muted-foreground break-keep">
                  이전 데이터라 어떤 제출본을 검토했는지는 연결 정보가 없습니다.
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function isReview(item: MilestoneDocumentCollectionHistory): boolean {
  return item.event !== 'SUBMITTED' && item.event !== 'RESUBMITTED';
}

function historyEntriesWithStableKeys(
  history: readonly MilestoneDocumentCollectionHistory[],
): readonly {
  readonly item: MilestoneDocumentCollectionHistory;
  readonly key: string;
}[] {
  const occurrences = new Map<string, number>();
  return history.map((item) => {
    const fingerprint = JSON.stringify([
      item.event,
      item.revision,
      item.actorNickname,
      item.createdAt,
      item.fileName,
      item.content?.text ?? null,
      item.comment,
    ]);
    const occurrence = (occurrences.get(fingerprint) ?? 0) + 1;
    occurrences.set(fingerprint, occurrence);
    return { item, key: `${fingerprint}:${occurrence}` };
  });
}
