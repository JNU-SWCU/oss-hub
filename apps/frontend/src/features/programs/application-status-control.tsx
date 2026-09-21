'use client';

import { ChevronDown } from 'lucide-react';
import type { ChangeEvent, ReactElement } from 'react';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { DECISION_OPTIONS } from './application-decision-refetch';
import {
  APPLICATION_STATUS_BADGE,
  APPLICATION_STATUS_LABELS,
} from './application-presentation';
import type { ApplicationStatus } from './types';

const STATUS_SURFACE: Readonly<Record<ApplicationStatus, string>> = {
  SUBMITTED: 'bg-status-pending-bg text-status-pending-fg',
  APPROVED: 'bg-status-approved-bg text-status-approved-fg',
  REJECTED: 'bg-status-rejected-bg text-status-rejected-fg',
};

/**
 * 신청 상태를 한 곳에서 바꾸고 읽는다. 목록과 상세가 같은 컨트롤을 쓴다 —
 * 배지와 드롭다운을 나란히 두면 같은 상태가 두 번 선다.
 *
 * 네이티브 `<select>`를 유지한다. 열림 UI를 직접 그리면 모바일 기본 피커와
 * 키보드 조작을 잃는다. 색은 StatusBadge와 같은 `--status-*` 토큰이고, 글자와
 * 셰브론이 색이 아닌 신호다.
 */
export function ApplicationStatusControl({
  value,
  disabled,
  id,
  'aria-label': ariaLabel,
  onChange,
}: {
  readonly value: ApplicationStatus;
  readonly disabled?: boolean;
  readonly id?: string;
  readonly 'aria-label': string;
  readonly onChange: (next: ApplicationStatus) => void;
}): ReactElement {
  return (
    <div className="relative inline-flex w-fit min-w-[7.5rem] max-w-full">
      <Select
        id={id}
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        data-status={value}
        data-variant={APPLICATION_STATUS_BADGE[value]}
        className={cn(
          'h-tag w-full min-w-0 cursor-pointer appearance-none py-0 pr-7 pl-2.5',
          'rounded-full border-transparent text-xs font-semibold',
          'focus-visible:border-ring disabled:bg-input/50',
          STATUS_SURFACE[value],
        )}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => {
          onChange(event.target.value as ApplicationStatus);
        }}
      >
        {DECISION_OPTIONS.map((status) => (
          <option key={status} value={status}>
            {APPLICATION_STATUS_LABELS[status]}
          </option>
        ))}
      </Select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2"
      />
    </div>
  );
}
