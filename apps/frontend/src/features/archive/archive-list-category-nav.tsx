'use client';

import { FilterChip, FilterChipGroup } from '@/components';
import { type ArchiveListFilter } from './types';

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
