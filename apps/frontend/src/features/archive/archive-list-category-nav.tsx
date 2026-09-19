'use client';

import { FilterChip, FilterChipGroup } from '@/components';
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
    <FilterChipGroup
      data-slot="archive-list-year-chips"
      aria-label="연도 필터"
      className={className}
    >
      {filters.map((filter) => {
        const label = filter === 'all' ? '전체' : String(filter);
        return (
          <FilterChip
            key={label}
            pressed={value === filter}
            onClick={() => onChange(filter)}
          >
            {label}
          </FilterChip>
        );
      })}
    </FilterChipGroup>
  );
}
