import type { ReactElement, ReactNode } from 'react';
import { StatusBadge } from '@/components';
import { cn } from '@/lib/utils';
import {
  COHORT_LABELS,
  DEPARTMENT_COHORTS,
  PROGRAM_CATEGORY_LABELS,
  type StaffInsightsProgramRow,
} from './types';

const periodFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: '2-digit',
  day: '2-digit',
});

const decimalFormatter = new Intl.NumberFormat('ko-KR', {
  maximumFractionDigits: 1,
});

function monthDay(date: Date): string {
  const parts = periodFormatter.formatToParts(date);
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const day = parts.find((part) => part.type === 'day')?.value ?? '';
  return `${month}.${day}`;
}

export function ratioText(value: number | null): string {
  return value === null ? '—' : `${decimalFormatter.format(value)}:1`;
}

function share(part: number, total: number): number {
  return total === 0 ? 0 : (part / total) * 100;
}

function SubLabel({ children }: { readonly children: ReactNode }) {
  return (
    <p className="mt-1.5 max-w-[7.5rem] whitespace-normal text-badge text-muted-foreground tabular-nums sm:max-w-none sm:whitespace-nowrap">
      {children}
    </p>
  );
}

export function ProgramCell({
  row,
}: {
  readonly row: StaffInsightsProgramRow;
}): ReactElement {
  return (
    <div className="grid w-[120px] gap-1.5 whitespace-normal [overflow-wrap:anywhere] sm:w-[220px]">
      <span
        data-slot="program-name"
        className="break-keep font-semibold text-foreground"
      >
        {row.name}
      </span>
      <span className="flex flex-wrap items-center gap-1.5 text-badge text-muted-foreground">
        <span className="rounded-full border border-border px-2">
          {PROGRAM_CATEGORY_LABELS[row.category]}
        </span>
        <span className="tabular-nums">
          {`${monthDay(row.startAt)}–${monthDay(row.endAt)}`}
        </span>
        {row.recruiting ? (
          <StatusBadge variant="recruiting">모집 중</StatusBadge>
        ) : null}
      </span>
    </div>
  );
}

export function RecruitmentCell({
  row,
  maxApplied,
}: {
  readonly row: StaffInsightsProgramRow;
  readonly maxApplied: number;
}): ReactElement {
  return (
    <div>
      <div
        aria-hidden="true"
        className="relative h-2 w-28 overflow-hidden rounded-full bg-muted"
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-primary/30"
          style={{ width: `${share(row.appliedCount, maxApplied)}%` }}
        />
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-primary"
          style={{ width: `${share(row.approvedCount, maxApplied)}%` }}
        />
      </div>
      <SubLabel>
        {`신청 ${row.appliedCount}건 → 승인 ${row.approvedCount}건 · ${ratioText(row.competitionRatio)}`}
      </SubLabel>
    </div>
  );
}

export function CompositionCell({
  row,
}: {
  readonly row: StaffInsightsProgramRow;
}): ReactElement {
  if (row.participantCount === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  const segments = [
    {
      cohort: DEPARTMENT_COHORTS.SW_MAJOR,
      count: row.swMajorCount,
      className: 'bg-chart-1',
    },
    {
      cohort: DEPARTMENT_COHORTS.NON_SW,
      count: row.nonSwCount,
      className: 'bg-chart-2',
    },
    {
      cohort: DEPARTMENT_COHORTS.UNREGISTERED,
      count: row.unregisteredCount,
      className: 'bg-muted-foreground',
    },
  ];
  return (
    <div>
      <div
        aria-hidden="true"
        className="flex h-2 w-28 overflow-hidden rounded-full bg-muted"
      >
        {segments.map((segment) => (
          <span
            key={segment.cohort}
            className={segment.className}
            style={{ width: `${share(segment.count, row.participantCount)}%` }}
          />
        ))}
      </div>
      <SubLabel>
        {`${row.participantCount}명 · 비SW ${Math.round(share(row.nonSwCount, row.participantCount))}%`}
      </SubLabel>
      <span className="sr-only">
        {segments
          .map(
            (segment) => `${COHORT_LABELS[segment.cohort]} ${segment.count}명`,
          )
          .join(', ')}
      </span>
    </div>
  );
}

export function completionTone(rate: number): string {
  if (rate >= 80) return 'text-status-approved-fg';
  if (rate >= 60) return 'text-foreground';
  return 'text-status-pending-fg';
}

export function MetricCell({
  value,
  className,
  label,
}: {
  readonly value: string | null;
  readonly className?: string;
  readonly label: string;
}): ReactElement {
  return (
    <div>
      <span
        className={cn(
          'text-body font-semibold tabular-nums',
          value === null ? 'text-muted-foreground' : className,
        )}
      >
        {value ?? '—'}
      </span>
      <SubLabel>{label}</SubLabel>
    </div>
  );
}

export function ScorecardLegend(): ReactElement {
  return (
    <div
      data-slot="program-scorecard-legend"
      className="flex flex-wrap gap-x-4 gap-y-2 text-badge text-muted-foreground"
    >
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="size-2.5 rounded-sm bg-chart-1" />
        {COHORT_LABELS[DEPARTMENT_COHORTS.SW_MAJOR]}
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="size-2.5 rounded-sm bg-chart-2" />
        {COHORT_LABELS[DEPARTMENT_COHORTS.NON_SW]}
      </span>
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="size-2.5 rounded-sm bg-muted-foreground"
        />
        {COHORT_LABELS[DEPARTMENT_COHORTS.UNREGISTERED]}
      </span>
    </div>
  );
}
