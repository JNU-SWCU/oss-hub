'use client';

import { cn } from '@/lib/utils';
import { type ArchiveListFilter } from './types';

/**
 * 좁은 폭용 연도 칩 — 데스크톱은 전역 사이드 패널 「공개 아카이브」가 담당.
 */
export function ArchiveListYearChips({
  years,
  value,
  onChange,
  className,
}: {
  readonly years: readonly number[];
  readonly value: ArchiveListFilter;
  readonly onChange: (filter: ArchiveListFilter) => void;
  readonly className?: string;
}) {
  const filters: readonly ArchiveListFilter[] = ['all', ...years];

  return (
    <div
      data-slot="archive-list-year-chips"
      role="toolbar"
      aria-label="연도 필터"
      className={cn('flex flex-wrap gap-2', className)}
    >
      {filters.map((filter) => {
        const active = value === filter;
        const label = filter === 'all' ? '전체' : String(filter);
        return (
          <button
            key={label}
            type="button"
            onClick={() => onChange(filter)}
            aria-pressed={active}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors',
              active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background text-foreground hover:bg-muted',
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
