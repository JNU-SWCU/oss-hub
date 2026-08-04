'use client';

import { cn } from '@/lib/utils';
import {
  PROGRAM_LIST_STATUSES,
  PROGRAM_LIST_STATUS_LABELS,
  type ProgramListStatus,
} from './types';

/**
 * 데이커 해커톤 메뉴 패턴 — 공개 프로그램 카탈로그 상태 필터.
 * 연습대회 항목 없음. 카운트 뱃지는 facet API 전까지 생략.
 */
export function ProgramListStatusNav({
  value,
  onChange,
  className,
}: {
  readonly value: ProgramListStatus;
  readonly onChange: (status: ProgramListStatus) => void;
  readonly className?: string;
}) {
  const parent = 'all' as const;
  const children = PROGRAM_LIST_STATUSES.filter((s) => s !== 'all');

  return (
    <div
      data-slot="program-list-status-nav"
      className={cn(
        'rounded-xl border border-border bg-card p-4 shadow-sm',
        className,
      )}
    >
      <h2 className="font-heading mb-4 text-lg font-bold text-foreground">
        프로그램 메뉴
      </h2>
      <nav aria-label="프로그램 상태 필터" className="space-y-1">
        <StatusRow
          active={value === parent}
          label={PROGRAM_LIST_STATUS_LABELS[parent]}
          onClick={() => onChange(parent)}
        />
        <div className="ml-3 space-y-1 border-l border-border pl-3">
          {children.map((status) => (
            <StatusRow
              key={status}
              active={value === status}
              label={PROGRAM_LIST_STATUS_LABELS[status]}
              onClick={() => onChange(status)}
            />
          ))}
        </div>
      </nav>
    </div>
  );
}

/**
 * 좁은 폭용 — 같은 상태를 한 줄 칩으로.
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

function StatusRow({
  label,
  active,
  onClick,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex w-full items-center justify-between rounded-lg px-4 py-3 text-sm font-bold transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-foreground/80 hover:bg-muted hover:text-foreground',
      )}
    >
      <span className="flex-1 truncate text-left">{label}</span>
    </button>
  );
}
