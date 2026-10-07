'use client';

import { FilterChip, FilterChipGroup } from '@/components';
import {
  PROGRAM_LIST_STATUSES,
  PROGRAM_LIST_STATUS_LABELS,
  type ProgramListStatus,
} from './types';

export function ProgramListStatusChips({
  value,
  onChange,
  className,
}: {
  readonly value: ProgramListStatus;
  readonly onChange: (status: ProgramListStatus) => void;
  readonly className?: string;
}) {
  return (
    <FilterChipGroup
      data-slot="program-list-status-chips"
      aria-label="프로그램 상태 필터"
      className={className}
    >
      {PROGRAM_LIST_STATUSES.map((status) => (
        <FilterChip
          key={status}
          pressed={value === status}
          onClick={() => onChange(status)}
        >
          {PROGRAM_LIST_STATUS_LABELS[status]}
        </FilterChip>
      ))}
    </FilterChipGroup>
  );
}
