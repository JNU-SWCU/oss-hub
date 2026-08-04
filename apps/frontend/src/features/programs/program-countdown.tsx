'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * 프로그램 스코프 사이드바 하단 — 다음 마감 마일스톤까지 초 단위 실시간 카운트다운
 * (chrome-tokens §2-3). 데이터는 순수 props(`nextMilestoneLabel`, `dueAt`)로만 받는다 —
 * 어떤 마일스톤이 "다음 마감"인지 고르는 로직은 호출부 책임이다.
 *
 * 서버 렌더 시점의 "지금"과 클라이언트 하이드레이션 시점의 "지금"은 항상 다르므로,
 * 마운트 전에는 시계를 그리지 않는 자리표시자만 낸다(서버 출력과 클라이언트 첫 렌더가
 * 동일해야 hydration mismatch가 안 난다) — 실제 시계는 `useEffect` 이후에만 켜진다.
 */
export interface ProgramCountdownProps {
  readonly nextMilestoneLabel: string;
  /** ISO8601. */
  readonly dueAt: string;
  /** 테스트 전용 — 주어지면 내부 시계를 켜지 않고 이 시각으로 고정 렌더한다. */
  readonly now?: Date;
}

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;

// 마감 시각은 학사 일정이라 서울 기준으로만 뜻이 통한다 — `board-format.ts`·`deadline.ts`와
// 같은 규약으로 실행 환경 시간대와 무관하게 Asia/Seoul로 고정해 읽는다.
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
  // en-GB + hour12:false 는 자정을 "24"로 내놓는 구현이 있어 그 경우만 접는다.
  return SEOUL_CLOCK_FORMAT.format(d).replace(/^24:/, '00:');
}

export function formatCountdownDate(d: Date): string {
  // en-CA는 `YYYY-MM-DD`를 준다 — 서울 달력일을 뽑아 그 날짜의 요일을 UTC 자정으로 되짚는다
  // (시간대 보정 없이 요일만 구하는 `deadline.ts`의 seoulCalendarDay와 같은 방식).
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

/** 이미 지난 마감이면 전부 0으로 바닥을 친다(음수 없음). */
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
}: ProgramCountdownProps) {
  const [clock, setClock] = useState<Date | null>(nowOverride ?? null);

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
      <p className="mt-3 text-xs text-muted-foreground">
        {nextMilestoneLabel} 마감까지
      </p>
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
