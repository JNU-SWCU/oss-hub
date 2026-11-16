'use client';

import { useId, type ReactElement } from 'react';
import { FilterChip, FilterChipGroup } from '@/components';
import { Button } from '@/components/ui/button';
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton';
import { submissionStatusLabel } from '@/lib/status-vocabulary';
import {
  matrixPageStats,
  matrixRowAction,
  type MatrixQuickFilter,
} from '../matrix';
import type { MatrixMilestone, MatrixRow } from '../types';

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

const STATS_STRIP_STATUSES = [
  'OVERDUE',
  'SUBMITTED',
  'CHANGES_REQUESTED',
  'APPROVED',
] as const;

const QUICK_FILTER_STATUSES = [
  'OVERDUE',
  'NOT_SUBMITTED',
  'SUBMITTED',
  'CHANGES_REQUESTED',
  'APPROVED',
  'REJECTED',
] as const;

export function MatrixStatsStrip({
  rows,
  milestones,
  now,
}: {
  readonly rows: readonly MatrixRow[];
  readonly milestones: readonly MatrixMilestone[];
  readonly now: Date;
}): ReactElement {
  const stats = matrixPageStats(rows, milestones, now);
  const facts = STATS_STRIP_STATUSES.map((status) => ({
    label: submissionStatusLabel(status, 'staff'),
    value: `${stats[status]}`,
  }));
  return (
    <div className="grid gap-3 rounded-card border border-border p-card">
      <p className="text-small text-muted-foreground">단계별 상태</p>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        {facts.map((fact) => (
          <div key={fact.label} className="flex flex-col gap-1">
            <dt className="text-small text-muted-foreground">{fact.label}</dt>
            <dd className="text-lg font-semibold">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function MatrixQuickFilterButtons({
  rows,
  visibleMilestones,
  now,
  quickFilter,
  onQuickFilterChange,
}: {
  readonly rows: readonly MatrixRow[];
  readonly visibleMilestones: readonly MatrixMilestone[];
  readonly now: Date;
  readonly quickFilter: MatrixQuickFilter;
  readonly onQuickFilterChange: (filter: MatrixQuickFilter) => void;
}): ReactElement {
  const titleId = useId();
  const rowActions = rows.map((row) =>
    matrixRowAction(row, visibleMilestones, now),
  );
  const options = [
    { value: 'ALL' as const, label: `전체 ${rows.length}` },
    ...QUICK_FILTER_STATUSES.map((value) => ({
      value,
      count: rowActions.filter((action) => action === value).length,
    }))
      .filter(({ value, count }) => count > 0 || quickFilter === value)
      .map(({ value, count }) => ({
        value,
        label: `${submissionStatusLabel(value, 'staff')} ${count}`,
      })),
  ];

  return (
    <FilterChipGroup aria-labelledby={titleId} className="max-w-full">
      <p id={titleId} className="w-full text-small font-semibold">
        상태
      </p>
      {options.map((option) => (
        <FilterChip
          key={option.value}
          pressed={quickFilter === option.value}
          onClick={() => onQuickFilterChange(option.value)}
        >
          {option.label}
        </FilterChip>
      ))}
    </FilterChipGroup>
  );
}
