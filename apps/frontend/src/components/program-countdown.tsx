'use client';

import { useEffect, useState } from 'react';

/**
 * Sidebar countdown — next milestone (programs) or next collection (ranking).
 * Data is props only. The caller chooses what "next" means.
 *
 * Server "now" and hydration "now" always differ, so the first render is an
 * empty placeholder. The live clock starts after mount.
 */
export interface CountdownMilestone {
  readonly label: string;
  readonly dueAt: string;
}

export interface SingleCountdownProps {
  readonly mode?: 'single';
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

export interface ProgramScheduleCountdownProps {
  readonly mode: 'program';
  readonly milestones: readonly CountdownMilestone[];
  readonly now?: Date;
}

export type ProgramCountdownProps =
  SingleCountdownProps | ProgramScheduleCountdownProps;

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

const SEOUL_HOUR_MINUTE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Seoul',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
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

const formatHourMinute = (d: Date): string =>
  SEOUL_HOUR_MINUTE_FORMAT.format(d).replace(/^24:/, '00:');

export const formatCountdownDateTime = (d: Date): string =>
  `${formatCountdownDate(d)} ${formatHourMinute(d)}`;

export const formatCountdownListDate = (d: Date): string =>
  `${formatCountdownDate(d).slice(0, 10)} ${formatHourMinute(d)}`;

export type RemainingTime = Readonly<
  Record<'days' | 'hours' | 'minutes' | 'seconds', number>
>;

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

export function activeMilestones(
  milestones: readonly CountdownMilestone[],
  now: Date,
): readonly CountdownMilestone[] {
  const nowTime = now.getTime();
  return milestones
    .filter(({ dueAt }) => new Date(dueAt).getTime() > nowTime)
    .slice()
    .sort(
      (left, right) =>
        new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime(),
    );
}

export function ProgramCountdown(props: ProgramCountdownProps) {
  const nowOverride = props.now;
  const [clock, setClock] = useState<Date | null>(
    nowOverride === undefined ? null : nowOverride,
  );

  useEffect(() => {
    if (nowOverride !== undefined) return;
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

  if (props.mode === 'program') {
    return <ProgramSchedule milestones={props.milestones} clock={clock} />;
  }

  return <SingleCountdown {...props} clock={clock} />;
}

function SingleCountdown({
  nextMilestoneLabel,
  dueAt,
  untilLabel,
  clock,
}: SingleCountdownProps & { readonly clock: Date }) {
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

type ProgramScheduleProps = {
  readonly milestones: readonly CountdownMilestone[];
  readonly clock: Date;
};

function ProgramSchedule({ milestones, clock }: ProgramScheduleProps) {
  const active = activeMilestones(milestones, clock);
  const nearest = active[0];

  return (
    <div
      data-slot="program-countdown"
      className="mx-3 shrink-0 border-t border-sidebar-border px-1 py-4"
    >
      <p className="text-xs text-muted-foreground">현재 시각</p>
      <p className="text-sm font-semibold text-sidebar-foreground tabular-nums">
        {formatClock(clock)}
      </p>
      <p className="text-xs text-muted-foreground tabular-nums">
        {formatCountdownDate(clock)}
      </p>
      {nearest === undefined ? (
        <p className="mt-3 text-sm text-muted-foreground">
          마감 일정이 종료되었습니다.
        </p>
      ) : (
        <ActiveProgramSchedule
          active={active}
          nearest={nearest}
          clock={clock}
        />
      )}
    </div>
  );
}

type ActiveProgramScheduleProps = {
  readonly active: readonly CountdownMilestone[];
  readonly nearest: CountdownMilestone;
  readonly clock: Date;
};

function ActiveProgramSchedule({
  active,
  nearest,
  clock,
}: ActiveProgramScheduleProps) {
  const remaining = remainingUntil(new Date(nearest.dueAt), clock);

  return (
    <>
      <p className="mt-3 min-w-0 truncate text-sm font-semibold text-sidebar-foreground">
        {nearest.label}
      </p>
      <div className="mt-2 grid grid-cols-4 gap-1">
        <CountdownCell value={remaining.days} unit="일" />
        <CountdownCell value={remaining.hours} unit="시간" />
        <CountdownCell value={remaining.minutes} unit="분" />
        <CountdownCell value={remaining.seconds} unit="초" />
      </div>
      <time
        dateTime={nearest.dueAt}
        className="mt-2 block whitespace-nowrap text-xs font-medium text-sidebar-foreground tabular-nums"
      >
        {formatCountdownDateTime(new Date(nearest.dueAt))}
      </time>
      <ul className="mt-3 space-y-1">
        {active.map((milestone, index) => (
          <li
            key={`${milestone.dueAt}:${milestone.label}:${index}`}
            className="flex min-w-0 items-baseline gap-1 text-xs text-muted-foreground"
          >
            <span className="min-w-0 truncate">{milestone.label}</span>
            <span aria-hidden className="shrink-0">
              —
            </span>
            <time
              dateTime={milestone.dueAt}
              className="shrink-0 whitespace-nowrap tabular-nums"
            >
              {formatCountdownListDate(new Date(milestone.dueAt))}
            </time>
          </li>
        ))}
      </ul>
    </>
  );
}

type CountdownValueProps = Readonly<{ value: number; unit: string }>;

function CountdownCell({ value, unit }: CountdownValueProps) {
  return (
    <span
      data-countdown-cell
      className="flex min-w-0 flex-col items-center rounded-md bg-muted/50 px-1 py-2 text-center"
    >
      <span className="text-xl font-bold text-primary tabular-nums">
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{unit}</span>
    </span>
  );
}

function CountdownUnit({ value, unit }: CountdownValueProps) {
  return (
    <span className="flex items-baseline gap-0.5">
      <span className="text-[22px] font-bold tracking-[-0.03em] text-primary tabular-nums">
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{unit}</span>
    </span>
  );
}
