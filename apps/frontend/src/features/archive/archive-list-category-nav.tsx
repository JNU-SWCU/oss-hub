'use client';

import { cn } from '@/lib/utils';
import {
  ARCHIVE_LIST_FILTERS,
  ARCHIVE_LIST_FILTER_LABELS,
  type ArchiveListFilter,
} from './types';

/**
 * 좁은 폭용 분류 칩 — 데스크톱은 전역 사이드 패널 「공개 아카이브」가 담당.
 */
export function ArchiveListCategoryChips({
  value,
  onChange,
  className,
}: {
  readonly value: ArchiveListFilter;
  readonly onChange: (filter: ArchiveListFilter) => void;
  readonly className?: string;
}) {
  return (
    <div
      data-slot="archive-list-category-chips"
      role="toolbar"
      aria-label="프로그램 분류 필터"
      className={cn('flex flex-wrap gap-2', className)}
    >
      {ARCHIVE_LIST_FILTERS.map((filter) => {
        const active = value === filter;
        return (
          <button
            key={filter}
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
            {ARCHIVE_LIST_FILTER_LABELS[filter]}
          </button>
        );
      })}
    </div>
  );
}
