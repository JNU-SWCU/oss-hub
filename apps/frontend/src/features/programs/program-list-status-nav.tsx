'use client';

import { FilterChip, FilterChipGroup } from '@/components';
import {
  PROGRAM_LIST_STATUSES,
  PROGRAM_LIST_STATUS_LABELS,
  type ProgramListStatus,
} from './types';

/**
 * 좁은 폭용 상태 칩 — 데스크톱은 전역 사이드 패널 「프로그램 메뉴」가 담당.
 */
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
