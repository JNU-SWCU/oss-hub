import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactElement } from 'react';
import { StatusBadge } from '@/components';
import {
  formatSubmittedAt,
  MATRIX_CELL_DISPLAY_LABELS,
  MATRIX_CELL_DISPLAY_VARIANTS,
  matrixCellDisplay,
  notSubmittedDeadline,
} from '../matrix';
import type { MatrixCell, MatrixMilestone } from '../types';

/**
 * 제출이 있는 칸만 검토 화면으로 연결한다. 미제출 칸은 마감 상태를 함께 보여
 * 교직원이 다음 행동이 필요한 팀을 표 안에서 바로 구분할 수 있게 한다.
 */
export function MatrixCellContent({
  cell,
  milestone,
  now,
}: {
  readonly cell: MatrixCell;
  readonly milestone: MatrixMilestone;
  readonly now: Date;
}): ReactElement {
  const display = matrixCellDisplay(cell, milestone);
  const badge = (
    <StatusBadge variant={MATRIX_CELL_DISPLAY_VARIANTS[display]}>
      {MATRIX_CELL_DISPLAY_LABELS[display]}
    </StatusBadge>
  );

  if (cell.status === 'NOT_SUBMITTED') {
    const deadline = notSubmittedDeadline(milestone.dueAt, now);
    return (
      <span className="flex flex-col items-start gap-1">
        {badge}
        <span
          className={
            deadline.overdue
              ? 'text-small font-semibold text-destructive'
              : 'text-small text-muted-foreground'
          }
        >
          {deadline.label}
        </span>
      </span>
    );
  }

  const submittedAtLabel =
    cell.submittedAt !== null ? formatSubmittedAt(cell.submittedAt) : null;
  const revisionLabel = cell.revision !== null ? `v${cell.revision}` : null;
  const secondaryLine = [submittedAtLabel, revisionLabel]
    .filter((part): part is string => part !== null)
    .join(' · ');
  const meta = (
    <span className="flex flex-col items-start gap-1">
      <span className="flex flex-wrap items-center gap-1">{badge}</span>
      {secondaryLine !== '' ? (
        <span className="text-small text-muted-foreground">
          {secondaryLine}
        </span>
      ) : null}
    </span>
  );

  if (cell.reviewUrl === null) return meta;
  return (
    <Link
      href={cell.reviewUrl}
      aria-label={`${milestone.name} 제출물 검토`}
      className="group inline-flex flex-col items-start gap-2 rounded-control focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      {meta}
      <span className="inline-flex items-center gap-1 text-small font-semibold text-primary underline-offset-4 group-hover:underline">
        열어 보기
        <ArrowRight aria-hidden="true" className="size-3.5" />
      </span>
    </Link>
  );
}
