'use client';

import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
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
  const options = [
    { value: undefined, label: '전체', count: total },
    ...STATUSES.map((value) => ({
      value,
      label: SUBMISSION_STATUS_LABELS[value],
      count: counts?.[value],
    })),
  ];
  return (
    <>
      <Select
        aria-label="제출 상태 필터"
        className="md:hidden"
        value={status ?? ''}
        onChange={(event) => {
          const value = event.currentTarget.value;
          onStatusChange(STATUSES.find((state) => state === value));
        }}
      >
        {options.map(({ value, label, count }) => (
          <option key={value ?? 'all'} value={value ?? ''}>
            {count === undefined ? label : `${label} ${count}`}
          </option>
        ))}
      </Select>
      <div
        role="group"
        aria-label="제출 상태 필터"
        className="hidden w-fit grid-flow-col gap-px overflow-hidden rounded-control border border-border bg-border md:grid"
      >
        {options.map(({ value, label, count }) => (
          <Button
            key={value ?? 'all'}
            type="button"
            variant="ghost"
            size="xs"
            aria-pressed={status === value}
            onClick={() => onStatusChange(value)}
            className={cn(
              'h-auto min-h-control rounded-none bg-background px-2 py-2 md:px-4',
              'focus-visible:z-10 focus-visible:ring-inset aria-pressed:bg-muted',
            )}
          >
            {label}
            {count === undefined ? null : (
              <>
                {' '}
                <span className="tabular-nums">{count}</span>
              </>
            )}
          </Button>
        ))}
      </div>
    </>
  );
}

export function SubmissionStatusLegend(): ReactElement {
  return (
    <ul
      aria-label="제출 상태 범례"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small sm:gap-x-4"
    >
      {STATUSES.map((status) => (
        <li key={status} className="[&>span]:gap-1">
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
  grouped = false,
  onSort,
  className,
}: {
  readonly children: ReactNode;
  readonly active: boolean;
  readonly direction: 'asc' | 'desc';
  readonly grouped?: boolean;
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
        active
          ? grouped
            ? 'other'
            : direction === 'asc'
              ? 'ascending'
              : 'descending'
          : undefined
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
        {active && grouped ? (
          <span className="sr-only">
            {`팀 단위 ${direction === 'asc' ? '오름차순' : '내림차순'}`}
          </span>
        ) : null}
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
