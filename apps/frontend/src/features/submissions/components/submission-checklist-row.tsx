import Link from 'next/link';
import { Download, FileText } from 'lucide-react';
import { ListRow, StatusBadge } from '@/components';
import { formatFileSize } from '@/lib/format-file-size';
import { programDocumentsHref } from '@/lib/program-route';
import {
  CHECKLIST_STATUS_LABELS,
  CHECKLIST_STATUS_VARIANTS,
  checklistItemStatus,
  hasMilestoneDeadlinePassed,
  milestoneDeadline,
} from '../submission-checklist';
import type { SubmissionChecklistItem, SubmissionFileMetadata } from '../types';
import { formatDeadline, TYPE_LABELS } from './submission-form-view';

export function submissionTriggerId(milestoneId: string): string {
  return `submission-trigger-${milestoneId}`;
}

export function ChecklistRow({
  programId,
  item,
  now,
  onSelectMilestone,
}: {
  readonly programId: string;
  readonly item: SubmissionChecklistItem;
  readonly now: Date;
  readonly onSelectMilestone?: (milestoneId: string) => void;
}) {
  const status = checklistItemStatus(item);
  const deadline = milestoneDeadline(item.dueAt, now);
  // 최초 제출은 마감(dueAt)이 지났으면 막는다 — 보완 요청의 재제출 예외는 보존한다.
  // 서버가 거절하는 기준과 같은 시각 비교로 판정한다. deadline.dDay는 달력일
  // 차이라 라벨에만 쓴다. "시작 전" 판정은 마일스톤에 시작 시각 데이터가 없어
  // 여기서는 낼 수 없다(스펙 Open Question #4 참고).
  //
  // 이때 열 화면이 없다 — 제출물이 없으니 볼 것도 없고, 열면 제출 폼이 나온다.
  // 그래서 링크를 걸지 않고 그 사실만 문장으로 적는다. 돌아올 포커스 자리는
  // 그대로 남겨야 해서(딥링크로 열린 창이 닫힐 때) 같은 id를 프로그램적으로만
  // 포커스되는 자리에 둔다.
  const lateBlocked =
    status === 'NOT_SUBMITTED' && hasMilestoneDeadlinePassed(item.dueAt, now);
  const triggerId = submissionTriggerId(item.milestoneId);
  const submissionHref = programDocumentsHref(programId, item.milestoneId);
  return (
    // 마일스톤 제출물은 서로 독립된 대상이 아니라 순서대로 이어지는 같은 성격의
    // 항목이다 — 항목마다 카드를 두면 테두리가 개수만큼 생겨 목록의 윤곽이
    // 사라진다(program-detail-view의 마일스톤 목록과 같은 규약).
    <ListRow role="listitem" className="min-w-0" data-testid="checklist-row">
      <div className="grid w-full min-w-0 flex-1 gap-1">
        {lateBlocked ? (
          <span
            id={triggerId}
            tabIndex={-1}
            className="w-fit min-w-0 font-semibold break-keep outline-none"
          >
            {item.name}
          </span>
        ) : (
          /*
            줄의 목적지는 「이 마일스톤의 제출 내역」이다. 상태마다 이름이 바뀌는
            버튼 모양 앵커(보기·올리기·다시 제출)는 같은 목적지를 세 이름으로
            부르면서 지역 동작처럼 보이게 했다 — 실제 제출·재제출 버튼은 열린
            창 안에 있다. 여기서는 이름 자체가 목적지 링크다.
          */
          <Link
            href={submissionHref}
            id={triggerId}
            aria-label={`${item.name} 제출 내역 열기`}
            className="w-fit min-w-0 font-semibold break-keep underline underline-offset-4 focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={
              onSelectMilestone
                ? (event) => {
                    if (
                      event.defaultPrevented ||
                      event.button !== 0 ||
                      event.metaKey ||
                      event.altKey ||
                      event.ctrlKey ||
                      event.shiftKey
                    ) {
                      return;
                    }
                    event.preventDefault();
                    onSelectMilestone(item.milestoneId);
                  }
                : undefined
            }
          >
            {item.name}
          </Link>
        )}
        {/*
          마감은 일정이지 심사 결과가 아니다. 예전에는 마감도 StatusBadge라
          「마감 지남」의 빨간 배지가 승인된 제출물 옆에 서서 실패한 제출처럼
          읽혔다. 배지는 제출 상태 하나만 쓰고 일정은 평범한 글로 적는다.
        */}
        <p className="text-small break-keep text-muted-foreground">
          마감 {formatDeadline(item.dueAt)} ·{' '}
          <span className="whitespace-nowrap">{deadline.label}</span> ·{' '}
          {TYPE_LABELS[item.submissionType]}
        </p>
        {lateBlocked ? (
          <p className="text-small break-keep text-muted-foreground">
            마감이 지나 새로 제출할 수 없습니다.
          </p>
        ) : null}
        {item.submission?.file ? (
          <SubmissionFileLink file={item.submission.file} compact />
        ) : null}
      </div>
      <StatusBadge variant={CHECKLIST_STATUS_VARIANTS[status]}>
        <span className="sr-only">제출 상태: </span>
        {CHECKLIST_STATUS_LABELS[status]}
      </StatusBadge>
    </ListRow>
  );
}

export function SubmissionFileLink({
  file,
  compact = false,
}: {
  readonly file: SubmissionFileMetadata;
  readonly compact?: boolean;
}) {
  return (
    <a
      href={file.downloadUrl}
      download={file.fileName}
      className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <FileText
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 truncate">{file.fileName}</span>
      <span className="shrink-0 text-muted-foreground">
        {formatFileSize(file.size)}
      </span>
      {compact ? null : (
        <Download
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
      )}
    </a>
  );
}
