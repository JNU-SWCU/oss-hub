import type { ReactElement } from 'react';
import { Button } from '@/components/ui/button';
import {
  DOCUMENT_DELIVERY_LABELS,
  DOCUMENT_DELIVERY_STATUSES,
} from '@/lib/document-delivery';
import {
  matrixPageStats,
  matrixRowDeliveryStatus,
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
}: {
  readonly rows: readonly MatrixRow[];
  readonly visibleMilestones: readonly MatrixMilestone[];
}): ReactElement {
  const visibleStats = matrixPageStats(rows, visibleMilestones);
  const facts: { readonly label: string; readonly value: string }[] = [
    {
      label: '필수 서류 제출',
      value: `${visibleStats.filledCells}/${visibleStats.totalCells}단계`,
    },
    { label: '미제출 있음', value: `${visibleStats.emptyCells}단계` },
    { label: '필수 서류 없음', value: `${visibleStats.noRequiredCells}단계` },
    { label: '지각 제출', value: `${visibleStats.lateCells}단계` },
  ];
  return (
    <div className="grid gap-3 rounded-card border border-border p-card">
      <p className="text-small text-muted-foreground">
        팀별 제출 단계 · 이 페이지 기준
      </p>
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
  quickFilter,
  onQuickFilterChange,
}: {
  readonly rows: readonly MatrixRow[];
  readonly visibleMilestones: readonly MatrixMilestone[];
  readonly quickFilter: MatrixQuickFilter;
  readonly onQuickFilterChange: (filter: MatrixQuickFilter) => void;
}): ReactElement {
  const options = [
    { value: 'ALL' as const, label: `전체 ${rows.length}팀` },
    ...DOCUMENT_DELIVERY_STATUSES.map((value) => ({
      value,
      label: `${DOCUMENT_DELIVERY_LABELS[value]} ${rows.filter((row) => matrixRowDeliveryStatus(row, visibleMilestones) === value).length}팀`,
    })),
  ];

  return (
    <div
      role="group"
      aria-label="필수 서류 제출 상태"
      className="flex max-w-full flex-wrap gap-2"
    >
      <p className="w-full text-small font-semibold">필수 서류 제출 상태</p>
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={quickFilter === option.value ? 'secondary' : 'ghost'}
          aria-pressed={quickFilter === option.value}
          className="px-3 text-small"
          onClick={() => onQuickFilterChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
