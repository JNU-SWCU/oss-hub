'use client';

import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton';
import { TableHead } from '@/components/ui/table';
import { SUBMISSION_STATUS_LABELS } from '@/lib/status-vocabulary';
import { cn } from '@/lib/utils';
import type { MatrixCell } from '../types';
import { SubmissionStatusMark } from './submission-matrix-cell';

export function MatrixPagination({
  page,
  totalPages,
  onPageChange,
}: {
  readonly page: number;
  readonly totalPages: number;
  readonly onPageChange: (page: number) => void;
}): ReactElement | null {
  if (totalPages <= 1) return null;
  return (
    <nav
      aria-label="제출 현황 페이지"
      className="flex items-center justify-center gap-3"
    >
      <Button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        variant="outline"
      >
        이전
      </Button>
      <span className="text-small text-muted-foreground">
        {page} / {totalPages}
      </span>
      <Button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        variant="outline"
      >
        다음
      </Button>
    </nav>
  );
}

export function MatrixSkeleton(): ReactElement {
  return (
    <Skeleton
      label="제출 현황을 불러오는 중"
      className="flex flex-col gap-3 rounded-card border border-border p-card"
    >
      <SkeletonBlock className="h-4 w-1/3 rounded" />
      {[0, 1, 2, 3].map((row) => (
        <SkeletonBlock key={row} className="h-3 w-full rounded" />
      ))}
    </Skeleton>
  );
}

const STATUSES = [
  'NOT_SUBMITTED',
  'SUBMITTED',
  'CHANGES_REQUESTED',
  'REJECTED',
  'APPROVED',
] as const satisfies readonly MatrixCell['status'][];

export type SubmissionStatusCounts = Readonly<
  Record<MatrixCell['status'], number>
>;

export function SubmissionStatusFilters({
  status,
  counts,
  onStatusChange,
}: {
  readonly status?: MatrixCell['status'];
  readonly counts?: SubmissionStatusCounts;
  readonly onStatusChange: (status: MatrixCell['status'] | undefined) => void;
}): ReactElement {
  const total =
    counts === undefined
      ? undefined
      : STATUSES.reduce((sum, state) => sum + counts[state], 0);
  return (
    <div
      role="group"
      aria-label="제출 상태 필터"
      className={cn(
        'grid w-full grid-cols-3 gap-px overflow-hidden rounded-control border border-border bg-border',
        'md:w-fit md:grid-flow-col md:grid-cols-none',
      )}
    >
      {[undefined, ...STATUSES].map((option) => {
        const count = option === undefined ? total : counts?.[option];
        return (
          <Button
            key={option ?? 'all'}
            type="button"
            variant="ghost"
            size="xs"
            aria-pressed={status === option}
            onClick={() => onStatusChange(option)}
            className={cn(
              'h-auto min-h-control rounded-none bg-background px-2 py-2 md:px-4',
              'focus-visible:z-10 focus-visible:ring-inset aria-pressed:bg-muted',
            )}
          >
            {option === undefined ? '전체' : SUBMISSION_STATUS_LABELS[option]}
            {count === undefined ? null : (
              <>
                {' '}
                <span className="tabular-nums">{count}</span>
              </>
            )}
          </Button>
        );
      })}
    </div>
  );
}

export function SubmissionStatusLegend(): ReactElement {
  return (
    <ul
      aria-label="제출 상태 범례"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 text-small"
    >
      {STATUSES.map((status) => (
        <li key={status}>
          <SubmissionStatusMark status={status} />
        </li>
      ))}
    </ul>
  );
}

export function SubmissionSortHeader({
  children,
  active,
  direction,
  onSort,
  className,
}: {
  readonly children: ReactNode;
  readonly active: boolean;
  readonly direction: 'asc' | 'desc';
  readonly onSort: () => void;
  readonly className?: string;
}): ReactElement {
  const Icon = active
    ? direction === 'asc'
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;
  return (
    <TableHead
      aria-sort={
        active ? (direction === 'asc' ? 'ascending' : 'descending') : undefined
      }
      className={className}
    >
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={onSort}
        className="h-auto min-h-control px-1.5 py-1 text-inherit hover:text-foreground"
      >
        {children}
        <Icon
          aria-hidden="true"
          className={cn(
            'size-3.5 shrink-0',
            active ? 'text-foreground' : 'opacity-60',
          )}
        />
      </Button>
    </TableHead>
  );
}
