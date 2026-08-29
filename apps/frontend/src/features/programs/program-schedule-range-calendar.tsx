import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  calendarWeeks,
  dateKey,
  segmentsForWeek,
  shiftDate,
  shiftMonth,
  type ProgramScheduleCalendarEvent,
  type ProgramScheduleEventKind,
  type ProgramScheduleWeekSegment,
} from './program-schedule-calendar-model';
import {
  dateWithinBounds,
  formatKoreanDate,
} from './program-schedule-range-selection';
import type { ProgramScheduleEditableRange } from './program-schedule-range-types';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;
const KIND_STYLES: Record<ProgramScheduleEventKind, string> = {
  APPLICATION: 'bg-blue-600 text-white',
  OPERATION: 'bg-emerald-700 text-white',
  MILESTONE: 'bg-amber-500 text-amber-950',
};

export function ProgramScheduleRangeCalendar({
  events,
  activeRange,
  monthKey,
  focusedDate,
  onMonthKeyChange,
  onFocusedDateChange,
  onDateSelect,
}: {
  readonly events: readonly ProgramScheduleCalendarEvent[];
  readonly activeRange: ProgramScheduleEditableRange;
  readonly monthKey: string;
  readonly focusedDate: string;
  readonly onMonthKeyChange: (value: string) => void;
  readonly onFocusedDateChange: (value: string) => void;
  readonly onDateSelect: (value: string) => void;
}) {
  const summaryId = useId();
  const calendarRef = useRef<HTMLDivElement>(null);
  const pendingFocusRef = useRef(false);
  const weeks = useMemo(() => calendarWeeks(monthKey), [monthKey]);

  useEffect(() => {
    if (!pendingFocusRef.current) return;
    calendarRef.current
      ?.querySelector<HTMLButtonElement>(
        `[data-calendar-date="${focusedDate}"]`,
      )
      ?.focus();
    pendingFocusRef.current = false;
  }, [focusedDate, monthKey]);

  function moveFocus(value: string, amount: number) {
    const next = shiftDate(value, amount);
    if (!dateWithinBounds(next, activeRange.minDate, activeRange.maxDate))
      return;
    pendingFocusRef.current = true;
    onFocusedDateChange(next);
    const nextMonth = next.slice(0, 7);
    if (nextMonth !== monthKey) onMonthKeyChange(nextMonth);
  }

  function changeMonth(amount: number) {
    const nextMonth = shiftMonth(monthKey, amount);
    if (!monthOverlapsBounds(nextMonth, activeRange)) return;
    const monthStart = `${nextMonth}-01`;
    const monthEnd = shiftDate(`${shiftMonth(nextMonth, 1)}-01`, -1);
    const nextFocus = clampDate(
      focusedDate.startsWith(nextMonth) ? focusedDate : monthStart,
      activeRange.minDate && activeRange.minDate > monthStart
        ? activeRange.minDate
        : monthStart,
      activeRange.maxDate && activeRange.maxDate < monthEnd
        ? activeRange.maxDate
        : monthEnd,
    );
    pendingFocusRef.current = true;
    onFocusedDateChange(nextFocus);
    onMonthKeyChange(nextMonth);
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    value: string,
  ) {
    const amount =
      event.key === 'ArrowLeft'
        ? -1
        : event.key === 'ArrowRight'
          ? 1
          : event.key === 'ArrowUp'
            ? -7
            : event.key === 'ArrowDown'
              ? 7
              : null;
    if (amount === null) return;
    event.preventDefault();
    moveFocus(value, amount);
  }

  return (
    <div
      className="overflow-hidden rounded-card border border-border bg-background"
      role="region"
      aria-label={`${activeRange.label} 날짜 선택 달력`}
      aria-describedby={summaryId}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 break-keep text-pretty">
          <strong>{formatMonth(monthKey)}</strong>
          <p className="text-small text-muted-foreground">
            {activeRange.kind === 'MILESTONE'
              ? '마일스톤 날짜 선택 · 운영 기간 밖은 선택할 수 없음'
              : `${activeRange.label} · 시작일과 종료일을 차례로 선택`}
          </p>
        </div>
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label="달력 월 이동"
        >
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="이전 달"
            disabled={
              !monthOverlapsBounds(shiftMonth(monthKey, -1), activeRange)
            }
            onClick={() => changeMonth(-1)}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="다음 달"
            disabled={
              !monthOverlapsBounds(shiftMonth(monthKey, 1), activeRange)
            }
            onClick={() => changeMonth(1)}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>
      <ul id={summaryId} className="sr-only">
        {events.map((event) => (
          <li key={event.id}>{scheduleEventSummary(event)}</li>
        ))}
      </ul>
      <div ref={calendarRef}>
        <div className="grid grid-cols-7 bg-muted/50 text-center text-small font-semibold text-muted-foreground">
          {WEEKDAYS.map((day) => (
            <span key={day} className="py-2">
              {day}
            </span>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week.id} className="border-t border-border/70 p-1.5">
            <div className="grid grid-cols-7">
              {week.days.map((day) => {
                const selectable = dateWithinBounds(
                  day,
                  activeRange.minDate,
                  activeRange.maxDate,
                );
                const isEndpoint =
                  activeRange.startAt.startsWith(day) ||
                  activeRange.endAt.startsWith(day);
                return (
                  <button
                    key={day}
                    type="button"
                    disabled={!selectable}
                    data-calendar-date={day}
                    tabIndex={focusedDate === day && selectable ? 0 : -1}
                    aria-label={`${formatKoreanDate(day)}${selectable ? '' : ', 선택할 수 없음'}`}
                    aria-pressed={isEndpoint}
                    className={`min-h-11 min-w-11 rounded-control text-small focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-muted/50 disabled:text-muted-foreground/40 ${isEndpoint ? 'bg-primary font-bold text-primary-foreground' : day.startsWith(monthKey) ? 'hover:bg-muted' : 'text-muted-foreground/50 hover:bg-muted'}`}
                    onClick={() => {
                      onFocusedDateChange(day);
                      onDateSelect(day);
                    }}
                    onKeyDown={(event) => handleKeyDown(event, day)}
                  >
                    {Number(day.slice(-2))}
                  </button>
                );
              })}
            </div>
            <div className="mt-1 grid gap-1">
              {segmentsForWeek(week, events).map((segment) => (
                <RangeSegment
                  key={`${segment.event.id}-${week.id}`}
                  segment={segment}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function scheduleEventSummary(event: ProgramScheduleCalendarEvent): string {
  const start = dateKey(event.startAt);
  const end = dateKey(event.endAt);
  if (start === null || end === null) return `${event.label}: 날짜 미지정`;
  return `${event.label}: ${formatKoreanDate(start)}부터 ${formatKoreanDate(end)}까지`;
}

function RangeSegment({
  segment,
}: {
  readonly segment: ProgramScheduleWeekSegment;
}) {
  return (
    <div className="grid grid-cols-7" aria-hidden="true">
      <div
        className={`min-w-0 px-2 py-1 text-xs font-semibold leading-4 ${KIND_STYLES[segment.event.kind]} ${segment.continuesBefore ? 'rounded-l-none' : 'rounded-l-md'} ${segment.continuesAfter ? 'rounded-r-none' : 'rounded-r-md'}`}
        style={{ gridColumn: `${segment.startColumn} / span ${segment.span}` }}
      >
        {segment.span > 1 ? (
          <span className="block truncate">{segment.event.label}</span>
        ) : null}
      </div>
    </div>
  );
}

function formatMonth(value: string): string {
  const [year, month] = value.split('-').map(Number);
  return `${year ?? ''}년 ${month ?? ''}월`;
}

function monthOverlapsBounds(
  monthKey: string,
  range: ProgramScheduleEditableRange,
): boolean {
  const start = `${monthKey}-01`;
  const end = shiftDate(`${shiftMonth(monthKey, 1)}-01`, -1);
  return (
    (range.minDate === undefined || end >= range.minDate) &&
    (range.maxDate === undefined || start <= range.maxDate)
  );
}

function clampDate(value: string, minDate: string, maxDate: string): string {
  if (value < minDate) return minDate;
  if (value > maxDate) return maxDate;
  return value;
}
