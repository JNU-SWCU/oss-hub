import {
  CircleCheck,
  CircleDashed,
  CircleSlash,
  Clock,
  RotateCcw,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactElement } from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { SUBMISSION_STATUS_LABELS } from '@/lib/status-vocabulary';
import { programSubmissionReviewHref } from '@/lib/program-route';
import { cn } from '@/lib/utils';
import { formatSubmittedAt, seoulCalendarDayNumber } from '../matrix-format';
import type { MatrixCell, MatrixMilestone } from '../types';

const STATUS_MARKS = {
  NOT_SUBMITTED: { icon: CircleDashed, tone: 'text-muted-foreground' },
  SUBMITTED: { icon: Clock, tone: 'text-status-pending-fg' },
  CHANGES_REQUESTED: { icon: RotateCcw, tone: 'text-status-pending-fg' },
  REJECTED: { icon: CircleSlash, tone: 'text-status-rejected-fg' },
  APPROVED: { icon: CircleCheck, tone: 'text-status-approved-fg' },
} as const satisfies Record<
  MatrixCell['status'],
  { icon: typeof CircleCheck; tone: string }
>;

const DEADLINE_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
});

function deadlineLabel(dueAt: string): string {
  const parts = DEADLINE_FORMAT.formatToParts(new Date(dueAt));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${part('month')}.${part('day')} (${part('weekday')}) 마감`;
}

export function SubmissionDeadline({
  dueAt,
}: {
  readonly dueAt: string;
}): ReactElement {
  return (
    <time
      dateTime={dueAt}
      className="text-small font-normal text-muted-foreground"
    >
      {deadlineLabel(dueAt)}
    </time>
  );
}

export function SubmissionStatusMark({
  status,
  deadline,
  iconOnly = false,
  showOverdueDate = false,
}: {
  readonly status: MatrixCell['status'];
  readonly deadline?: { readonly dueAt: string; readonly now: Date };
  readonly iconOnly?: boolean;
  readonly showOverdueDate?: boolean;
}): ReactElement {
  const { icon: Icon, tone } = STATUS_MARKS[status];
  const overdue =
    status === 'NOT_SUBMITTED' &&
    deadline !== undefined &&
    deadline.now.getTime() > Date.parse(deadline.dueAt);
  const mark = (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-medium whitespace-nowrap',
        overdue ? 'text-status-rejected-fg' : tone,
      )}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className={iconOnly ? 'sr-only' : undefined}>
        {SUBMISSION_STATUS_LABELS[status]}
      </span>
    </span>
  );
  if (!overdue || deadline === undefined) return mark;

  const { dueAt, now } = deadline;
  const elapsedDays =
    seoulCalendarDayNumber(now) - seoulCalendarDayNumber(new Date(dueAt));
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className="inline-flex rounded-control focus-visible:ring-2 focus-visible:ring-ring"
          >
            {mark}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {deadlineLabel(dueAt)} · {elapsedDays}일 지남
        </TooltipContent>
      </Tooltip>
      {showOverdueDate ? <SubmissionDeadline dueAt={dueAt} /> : null}
    </span>
  );
}

export function hasMatrixSubmissionStatus(cell: MatrixCell): boolean {
  return (
    cell.status !== 'NOT_SUBMITTED' ||
    cell.deliveryStatus !== 'NO_REQUIRED_ITEMS'
  );
}

export function MatrixCellContent({
  programId,
  cell,
  milestone,
  now,
  iconOnly = false,
  showSubmission = false,
}: {
  readonly programId: string;
  readonly cell: MatrixCell;
  readonly milestone: MatrixMilestone;
  readonly now: Date;
  readonly iconOnly?: boolean;
  readonly showSubmission?: boolean;
}): ReactElement {
  if (!hasMatrixSubmissionStatus(cell)) {
    return (
      <span aria-label="필수 서류 없음" className="text-muted-foreground">
        —
      </span>
    );
  }
  const mark = (
    <SubmissionStatusMark
      status={cell.status}
      iconOnly={iconOnly}
      deadline={{ dueAt: milestone.dueAt, now }}
    />
  );
  if (iconOnly) return mark;

  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {cell.submissionId !== null && cell.status !== 'NOT_SUBMITTED' ? (
        <Link
          href={programSubmissionReviewHref(programId, cell.submissionId)}
          className="inline-flex rounded-control underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="sr-only">{milestone.name} 제출물 검토: </span>
          {mark}
        </Link>
      ) : (
        mark
      )}
      <SubmissionDeadline dueAt={milestone.dueAt} />
      {showSubmission && cell.submittedAt !== null ? (
        <time
          dateTime={cell.submittedAt}
          className="text-small text-muted-foreground"
        >
          {formatSubmittedAt(cell.submittedAt)} 제출
          {cell.revision !== null ? ` · v${cell.revision}` : null}
        </time>
      ) : null}
    </span>
  );
}
