'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Sidebar countdown — next milestone (programs) or next collection (ranking).
 * Data is props only. The caller chooses what "next" means.
 *
 * Server "now" and hydration "now" always differ, so the first render is an
 * empty placeholder. The live clock starts after mount.
 */
export interface ProgramCountdownProps {
  readonly nextMilestoneLabel: string;
  /** ISO8601. */
  readonly dueAt: string;
  /** Test-only — skip the live clock and render this instant. */
  readonly now?: Date;
  /**
   * Line under the date. When omitted, `${nextMilestoneLabel} 마감까지`.
   * Ranking passes `다음 수집까지`.
   */
  readonly untilLabel?: string;
}

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;

const SEOUL_CLOCK_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Seoul',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const SEOUL_DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatClock(d: Date): string {
  return SEOUL_CLOCK_FORMAT.format(d).replace(/^24:/, '00:');
}

export function formatCountdownDate(d: Date): string {
  const [year, month, day] = SEOUL_DATE_FORMAT.format(d).split('-').map(Number);
  const weekday =
    WEEKDAY_LABELS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${year}.${pad2(month)}.${pad2(day)} (${weekday})`;
}

export interface RemainingTime {
  readonly days: number;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
}

/** Past deadlines floor to zero (never negative). */
export function remainingUntil(due: Date, now: Date): RemainingTime {
  const totalSeconds = Math.max(
    0,
    Math.floor((due.getTime() - now.getTime()) / 1000),
  );
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

export function ProgramCountdown({
  nextMilestoneLabel,
  dueAt,
  now: nowOverride,
  untilLabel,
}: ProgramCountdownProps) {
  const [clock, setClock] = useState<Date | null>(
    nowOverride === undefined ? null : nowOverride,
  );

  useEffect(() => {
    if (nowOverride) return;
    setClock(new Date());
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, [nowOverride]);

  if (clock === null) {
    return (
      <div
        data-slot="program-countdown"
        aria-hidden
        className="mx-3 shrink-0 border-t border-sidebar-border px-1 py-4"
      />
    );
  }

  const remaining = remainingUntil(new Date(dueAt), clock);
  const untilText =
    untilLabel === undefined ? `${nextMilestoneLabel} 마감까지` : untilLabel;

  return (
    <div
      data-slot="program-countdown"
      className="mx-3 shrink-0 border-t border-sidebar-border px-1 py-4"
    >
      <p className="text-xs text-muted-foreground">현재 시각</p>
      <p className="text-[22px] font-bold tracking-[-0.03em] text-sidebar-foreground tabular-nums">
        {formatClock(clock)}
      </p>
      <p className="text-xs text-muted-foreground tabular-nums">
        {formatCountdownDate(clock)}
      </p>
      <p className="mt-3 text-xs text-muted-foreground">{untilText}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <CountdownUnit value={remaining.days} unit="일" />
        <CountdownUnit value={remaining.hours} unit="시간" />
        <CountdownUnit value={remaining.minutes} unit="분" />
        <CountdownUnit value={remaining.seconds} unit="초" />
      </div>
    </div>
  );
}

function CountdownUnit({
  value,
  unit,
}: {
  readonly value: number;
  readonly unit: string;
}) {
  return (
    <span className={cn('flex items-baseline gap-0.5')}>
      <span className="text-[22px] font-bold tracking-[-0.03em] text-primary tabular-nums">
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{unit}</span>
    </span>
  );
}
