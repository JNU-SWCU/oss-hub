import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactElement } from 'react';
import { StatusBadge } from '@/components';
import {
  SUBMISSION_DISPLAY_BADGE,
  submissionStatusLabel,
} from '@/lib/status-vocabulary';
import { programSubmissionReviewHref } from '@/lib/program-route';
import { cn } from '@/lib/utils';
import {
  formatSubmittedAt,
  matrixCellAction,
  notSubmittedDeadline,
} from '../matrix';
import type { MatrixCell, MatrixMilestone } from '../types';

export function MatrixCellContent({
  programId,
  cell,
  milestone,
  now,
  focused,
}: {
  readonly programId: string;
  readonly cell: MatrixCell;
  readonly milestone: MatrixMilestone;
  readonly now: Date;
  readonly focused: boolean;
}): ReactElement {
  const action = matrixCellAction(cell, milestone, now);
  if (action.status === 'NONE') {
    return (
      <span aria-label="필수 서류 없음" className="text-muted-foreground">
        —
      </span>
    );
  }
  const badge = (
    <span className="flex flex-wrap items-center gap-1">
      <StatusBadge variant={SUBMISSION_DISPLAY_BADGE[action.status]}>
        {submissionStatusLabel(action.status, 'staff')}
      </StatusBadge>
      {action.late ? (
        <span className="text-small text-muted-foreground">· 지각</span>
      ) : null}
    </span>
  );
  const changeRequests =
    cell.changesRequestedCount > 0 ? (
      <span className="text-small font-semibold text-foreground">
        보완 요청 중 {cell.changesRequestedCount}건
      </span>
    ) : null;

  const deadline =
    action.status === 'OVERDUE' ||
    (action.status === 'NOT_SUBMITTED' && !focused)
      ? notSubmittedDeadline(milestone.dueAt, now)
      : null;

  const submittedAtLabel =
    cell.submittedAt !== null ? formatSubmittedAt(cell.submittedAt) : null;
  const revisionLabel = cell.revision !== null ? `v${cell.revision}` : null;
  const secondaryLine = [submittedAtLabel, revisionLabel]
    .filter((part): part is string => part !== null)
    .join(' · ');
  const meta = (
    <span className="flex flex-col items-start gap-1">
      {badge}
      {deadline !== null ? (
        <span
          className={
            deadline.overdue
              ? 'text-small font-semibold text-destructive'
              : 'text-small text-muted-foreground'
          }
        >
          {deadline.label}
        </span>
      ) : null}
      {secondaryLine !== '' ? (
        <span className="text-small text-muted-foreground">
          {secondaryLine}
        </span>
      ) : null}
      {changeRequests}
    </span>
  );

  if (cell.status === 'NOT_SUBMITTED' || cell.submissionId === null)
    return meta;
  return (
    <Link
      href={programSubmissionReviewHref(programId, cell.submissionId)}
      aria-label={`${milestone.name} 제출물 검토`}
      className={cn(
        'group inline-flex flex-col items-start gap-2 rounded-control',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'focus-visible:outline-none',
      )}
    >
      {meta}
      <span className="inline-flex items-center gap-1 text-small font-semibold text-primary underline-offset-4 group-hover:underline">
        열어 보기
        <ArrowRight aria-hidden="true" className="size-3.5" />
      </span>
    </Link>
  );
}
