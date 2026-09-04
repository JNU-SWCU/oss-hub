import { Download, FileText } from 'lucide-react';
import { useId, type ReactElement } from 'react';
import { Button } from '@/components/ui/button';
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
            {missingRevisionRange(firstKnownSubmission.revision)}차 제출본은
            남아 있지 않아 이 목록에 나오지 않습니다. 그 제출본이 필요하면
            프로그램 담당자에게 문의해 주세요.
          </p>
        ) : null}
        {completeness === 'incomplete' ? (
          <p className="text-small text-muted-foreground break-keep">
            지난 제출본 가운데 일부는 남아 있지 않아 이 목록에 나오지 않습니다.
            그 제출본이 필요하면 프로그램 담당자에게 문의해 주세요.
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
                <HistoryFile fileName={item.fileName} href={item.downloadUrl} />
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

/**
 * 남아 있지 않은 앞 제출본의 차수 표기.
 *
 * 한 건뿐일 때 범위로 쓰지 않는다 — 「1~1차」는 읽는 사람이 두 번 세게 만든다.
 */
function missingRevisionRange(firstKnownRevision: number): string {
  const lastMissingRevision = firstKnownRevision - 1;
  return lastMissingRevision === 1 ? '1' : `1~${lastMissingRevision}`;
}

/**
 * 이력에 남은 첨부 한 건.
 *
 * 주소가 있으면 내려받기 링크로, 없으면 이름만 글자로 그린다. 보관 기한이 지나 실제로
 * 지워진 파일에는 서버가 주소를 주지 않으므로(`downloadUrl`), 이름만 보고 링크를 세우면
 * 눌러도 404가 나는 버튼이 생긴다.
 *
 * ⚠ 이 자리는 학생 화면과 교직원 검토 패널이 함께 쓴다. 내려받기 API의 권한은
 * `GET /submission-files/:fileId`가 소유한다 — 교직원·관리자는 전부, 그 밖에는 올린
 * 본인이거나 같은 팀원이다. 화면이 역할을 다시 판정하지 않는 이유가 그것이다.
 */
function HistoryFile({
  fileName,
  href,
}: {
  readonly fileName: string;
  readonly href: string | null;
}): ReactElement {
  if (href === null) {
    return (
      <p className="flex min-w-0 items-center gap-2 text-small">
        <FileText className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate" title={fileName}>
          {fileName}
        </span>
      </p>
    );
  }
  return (
    <p className="flex min-w-0 text-small">
      <Button
        asChild
        size="sm"
        variant="ghost"
        className="h-auto max-w-full justify-start px-2 py-1"
      >
        {/*
         * `download`를 붙여도 되는 자리다 — 파일 한 건이고 이름을 이미 알고 있다
         * (양식 다운로드와 같다). 이름을 모르는 ZIP 쪽이 이 속성을 일부러 안 쓰는
         * 것과는 사정이 다르다.
         */}
        <a
          href={href}
          download={fileName}
          aria-label={`${fileName} 내려받기`}
          title={fileName}
        >
          <FileText className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">{fileName}</span>
          <Download className="size-4 shrink-0" aria-hidden="true" />
        </a>
      </Button>
    </p>
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
