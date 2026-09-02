import { Check } from 'lucide-react';
import type { ReactElement } from 'react';
import { Button } from '@/components/ui/button';
import {
  matrixPageStats,
  matrixRowHasEmptyCell,
  matrixRowIsZeroSubmission,
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
    <div
      aria-busy="true"
      aria-label="제출 현황을 불러오는 중"
      className="flex flex-col gap-3 rounded-card border border-border p-card"
    >
      <span className="h-4 w-1/3 animate-pulse rounded bg-muted" />
      {[0, 1, 2, 3].map((row) => (
        <span key={row} className="h-3 w-full animate-pulse rounded bg-muted" />
      ))}
    </div>
  );
}

export function MatrixStatsStrip({
  rows,
  visibleMilestones,
  allMilestones,
}: {
  readonly rows: readonly MatrixRow[];
  readonly visibleMilestones: readonly MatrixMilestone[];
  readonly allMilestones: readonly MatrixMilestone[];
}): ReactElement {
  const visibleStats = matrixPageStats(rows, visibleMilestones);
  const allStats = matrixPageStats(rows, allMilestones);
  const facts: { readonly label: string; readonly value: string }[] = [
    {
      label: '제출',
      value: `${visibleStats.filledCells}/${visibleStats.totalCells}`,
    },
    { label: '미제출', value: `${visibleStats.emptyCells}건` },
    { label: '전체 미제출', value: `${allStats.zeroSubmissionRows}팀` },
    { label: '지각', value: `${visibleStats.lateCells}건` },
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-card border border-border p-card sm:grid-cols-4">
      {facts.map((fact) => (
        <div key={fact.label} className="flex flex-col gap-1">
          <dt className="text-small text-muted-foreground">{fact.label}</dt>
          <dd className="text-lg font-semibold">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function MatrixQuickFilterButtons({
  rows,
  visibleMilestones,
  allMilestones,
  focused,
  quickFilter,
  onQuickFilterChange,
}: {
  readonly rows: readonly MatrixRow[];
  readonly visibleMilestones: readonly MatrixMilestone[];
  readonly allMilestones: readonly MatrixMilestone[];
  readonly focused: boolean;
  readonly quickFilter: MatrixQuickFilter;
  readonly onQuickFilterChange: (filter: MatrixQuickFilter) => void;
}): ReactElement {
  const hasEmptyCount = rows.filter((row) =>
    matrixRowHasEmptyCell(row, visibleMilestones),
  ).length;
  const zeroSubmissionCount = rows.filter((row) =>
    matrixRowIsZeroSubmission(row, allMilestones),
  ).length;
  const options: {
    readonly value: MatrixQuickFilter;
    readonly label: string;
  }[] = [
    { value: 'ALL', label: `전체 ${rows.length}팀` },
    {
      value: 'HAS_EMPTY',
      label: focused
        ? `이 단계 미제출 ${hasEmptyCount}팀`
        : `미제출 포함 ${hasEmptyCount}팀`,
    },
    {
      value: 'ZERO_SUBMISSION',
      label: `전체 미제출 ${zeroSubmissionCount}팀`,
    },
  ];

  return (
    <div
      role="group"
      aria-label="빠른 필터"
      className="inline-flex w-fit max-w-full divide-x divide-border overflow-x-auto rounded-control border border-border"
    >
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={quickFilter === option.value ? 'secondary' : 'ghost'}
          aria-pressed={quickFilter === option.value}
          className="rounded-none border-0 px-4 text-small"
          onClick={() => onQuickFilterChange(option.value)}
        >
          {option.label}
          {quickFilter === option.value ? (
            <span
              data-slot="matrix-quick-filter-selection"
              className="inline-flex items-center gap-1 text-xs font-bold"
            >
              <Check aria-hidden="true" className="size-3" />
              선택됨
            </span>
          ) : null}
        </Button>
      ))}
    </div>
  );
}
