import Link from 'next/link';
import { Download, FileText } from 'lucide-react';
import { ListRow, StatusBadge } from '@/components';
import { formatFileSize } from '@/lib/format-file-size';
import { programDocumentsHref } from '@/lib/program-route';
import {
  SUBMISSION_STATUS_BADGE,
  SUBMISSION_STATUS_LABELS,
} from '@/lib/status-vocabulary';
import { cn } from '@/lib/utils';
import {
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

  const lateBlocked =
    status === 'NOT_SUBMITTED' && hasMilestoneDeadlinePassed(item.dueAt, now);

  const previousChangesRequested =
    item.submission?.status === 'SUBMITTED' &&
    item.submission.decision === 'CHANGES_REQUESTED';
  const triggerId = submissionTriggerId(item.milestoneId);
  const submissionHref = programDocumentsHref(programId, item.milestoneId);
  return (
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
          <Link
            href={submissionHref}
            id={triggerId}
            aria-label={`${item.name} 제출 내역 열기`}
            className={cn(
              'w-fit min-w-0 font-semibold break-keep underline underline-offset-4',
              'focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50',
              'focus-visible:outline-none',
            )}
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

        <p className="text-small break-keep text-muted-foreground">
          마감 {formatDeadline(item.dueAt)} ·{' '}
          <span className="whitespace-nowrap">{deadline.label}</span> ·{' '}
          {TYPE_LABELS[item.submissionType]}
        </p>
        {previousChangesRequested ? (
          <p className="text-small break-keep text-muted-foreground">
            이전 검토 결과: {SUBMISSION_STATUS_LABELS.CHANGES_REQUESTED}
          </p>
        ) : null}
        {lateBlocked ? (
          <p className="text-small break-keep text-muted-foreground">
            마감이 지나 새로 제출할 수 없습니다.
          </p>
        ) : null}
        {item.submission?.file ? (
          <SubmissionFileLink file={item.submission.file} compact />
        ) : null}
      </div>
      <StatusBadge variant={SUBMISSION_STATUS_BADGE[status]}>
        <span className="sr-only">제출 상태: </span>
        {SUBMISSION_STATUS_LABELS[status]}
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
      className={cn(
        'inline-flex min-w-0 max-w-full items-center gap-1.5',
        'rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground',
        'transition-colors hover:bg-muted hover:text-foreground',
        'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
      )}
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
