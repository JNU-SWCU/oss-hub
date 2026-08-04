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

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatClock(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function formatCountdownDate(d: Date): string {
  const weekday = WEEKDAY_LABELS[d.getDay()];
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())} (${weekday})`;
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
