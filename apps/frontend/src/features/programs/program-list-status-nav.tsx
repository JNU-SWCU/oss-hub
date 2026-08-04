'use client';

import { cn } from '@/lib/utils';
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
    <div
      data-slot="program-list-status-chips"
      role="toolbar"
      aria-label="프로그램 상태 필터"
      className={cn('flex flex-wrap gap-2', className)}
    >
      {PROGRAM_LIST_STATUSES.map((status) => {
        const active = value === status;
        return (
          <button
            key={status}
            type="button"
            onClick={() => onChange(status)}
            aria-pressed={active}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors',
              active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background text-foreground hover:bg-muted',
            )}
          >
            {PROGRAM_LIST_STATUS_LABELS[status]}
          </button>
        );
      })}
    </div>
  );
}
