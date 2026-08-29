'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  dateKey,
  monthKeyForEvents,
  type ProgramScheduleCalendarEvent,
} from './program-schedule-calendar-model';
import { ProgramScheduleRangeCalendar } from './program-schedule-range-calendar';
import {
  dateTimeForDate,
  formatKoreanDate,
  planRangeDateSelection,
  timePart,
} from './program-schedule-range-selection';
import type { ProgramScheduleEditableRange } from './program-schedule-range-types';

export function ProgramScheduleRangeEditor({
  ranges,
  activeId,
  validationActiveId,
  onActiveIdChange,
  contextEvents = [],
  headerAction,
  activeExtra,
}: {
  readonly ranges: readonly ProgramScheduleEditableRange[];
  readonly activeId: string;
  readonly validationActiveId?: string | null;
  readonly onActiveIdChange: (value: string) => void;
  readonly contextEvents?: readonly ProgramScheduleCalendarEvent[];
  readonly headerAction?: ReactNode;
  readonly activeExtra?: ReactNode;
}) {
  const activeRange =
    ranges.find((range) => range.id === (validationActiveId ?? activeId)) ??
    ranges[0];
  const events = useMemo(
    () => [
      ...contextEvents.filter(
        (event) => !ranges.some((range) => range.id === event.id),
      ),
      ...ranges.flatMap((range) =>
        range.startAt && range.endAt
          ? [
              {
                id: range.id,
                label: range.label,
                kind: range.kind,
                startAt: range.startAt,
                endAt: range.endAt,
              },
            ]
          : [],
      ),
    ],
    [contextEvents, ranges],
  );
  const initialDate = clampDateToRange(
    (activeRange && dateKey(activeRange.startAt)) ??
      activeRange?.minDate ??
      `${monthKeyForEvents(events)}-01`,
    activeRange,
  );
  const [monthKey, setMonthKey] = useState(initialDate.slice(0, 7));
  const [focusedDate, setFocusedDate] = useState(initialDate);
  const [anchorDate, setAnchorDate] = useState<string | null>(null);

  useEffect(() => {
    if (
      validationActiveId !== null &&
      validationActiveId !== undefined &&
      validationActiveId !== activeId
    )
      onActiveIdChange(validationActiveId);
  }, [activeId, onActiveIdChange, validationActiveId]);

  useEffect(() => {
    if (activeRange === undefined) return;
    const nextDate = clampDateToRange(
      dateKey(activeRange.startAt) ?? activeRange.minDate ?? focusedDate,
      activeRange,
    );
    setFocusedDate(nextDate);
    setMonthKey(nextDate.slice(0, 7));
    setAnchorDate(null);
  }, [activeRange?.id]);

  if (activeRange === undefined) return null;

  function selectDate(value: string) {
    const plan = planRangeDateSelection({
      anchorDate,
      clickedDate: value,
      currentStartAt: activeRange.startAt,
      currentEndAt: activeRange.endAt,
    });
    activeRange.onStartAtChange(plan.startAt);
    activeRange.onEndAtChange(plan.endAt);
    setAnchorDate(plan.anchorDate);
  }

  const startDate = dateKey(activeRange.startAt);
  const endDate = dateKey(activeRange.endAt);

  return (
    <Card className="overflow-hidden border-primary/30 bg-primary/5">
      <CardHeader className="gap-1">
        <CardTitle className="break-keep text-pretty">
          신청·운영·마일스톤 일정
        </CardTitle>
        <p className="break-keep text-small text-muted-foreground">
          정할 일정을 고른 뒤 같은 달력에서 시작일과 종료일을 차례로 선택합니다.
        </p>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-[minmax(13rem,0.75fr)_minmax(0,1.5fr)]">
        <div className="grid content-start gap-2" aria-label="일정 작성 순서">
          {ranges.map((range, index) => {
            const selected = range.id === activeRange.id;
            return (
              <button
                key={range.id}
                type="button"
                aria-pressed={selected}
                data-invalid={Boolean(range.startError || range.endError)}
                className={`min-h-16 rounded-card border px-4 py-3 text-left break-keep text-pretty focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'border-primary bg-primary/10 shadow-[inset_3px_0_0_var(--primary)]' : 'border-border bg-background hover:border-primary/60'}`}
                onClick={() => onActiveIdChange(range.id)}
              >
                <span className="flex items-center justify-between gap-2">
                  <strong className="text-small">
                    {index + 1}. {range.label}
                  </strong>
                  <span className="text-xs font-semibold text-primary">
                    {selected
                      ? anchorDate
                        ? '마감일 선택'
                        : '선택 중'
                      : range.startAt && range.endAt
                        ? '완료'
                        : '날짜 선택'}
                  </span>
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {rangeSummary(range)}
                </span>
              </button>
            );
          })}
          {headerAction}
        </div>
        <div className="grid min-w-0 gap-4">
          <ProgramScheduleRangeCalendar
            events={events}
            activeRange={activeRange}
            monthKey={monthKey}
            focusedDate={focusedDate}
            selectionInvalid={
              (Boolean(activeRange.startError) &&
                dateKey(activeRange.startAt) === null) ||
              (Boolean(activeRange.endError) &&
                dateKey(activeRange.endAt) === null)
            }
            onMonthKeyChange={setMonthKey}
            onFocusedDateChange={setFocusedDate}
            onDateSelect={selectDate}
          />
          <section
            className="rounded-card border border-primary/20 bg-background p-4 text-small"
            aria-live="polite"
          >
            <strong className="text-primary">{activeRange.label}</strong>
            <p className="mt-1 break-keep text-muted-foreground">
              {selectionDescription(activeRange, anchorDate)}
            </p>
          </section>
          {activeExtra}
          <Field>
            <FieldLabel>시각 선택</FieldLabel>
            <p className="break-keep text-pretty text-small text-muted-foreground">
              선택한 기간의 시작 시각과 마감 시각을 입력해 주세요.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <TimeField
                id={activeRange.startInputId}
                label="시작 시각"
                value={timePart(activeRange.startAt)}
                disabled={startDate === null}
                error={activeRange.startError}
                onChange={(value) => {
                  if (startDate !== null)
                    activeRange.onStartAtChange(
                      dateTimeForDate(
                        startDate,
                        `${startDate}T${value}`,
                        '00:00',
                      ),
                    );
                }}
              />
              <TimeField
                id={activeRange.endInputId}
                label="마감 시각"
                value={timePart(activeRange.endAt)}
                disabled={endDate === null || Boolean(activeRange.endDisabled)}
                error={activeRange.endError}
                onChange={(value) => {
                  if (endDate !== null)
                    activeRange.onEndAtChange(
                      dateTimeForDate(endDate, `${endDate}T${value}`, '23:59'),
                    );
                }}
              />
            </div>
          </Field>
        </div>
      </CardContent>
    </Card>
  );
}

function TimeField({
  id,
  label,
  value,
  disabled,
  error,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly error?: string;
  readonly onChange: (value: string) => void;
}) {
  const errorId = `${id}-error`;
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="time"
        value={value}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldError id={errorId} role="alert">
        {error}
      </FieldError>
    </Field>
  );
}

function rangeSummary(range: ProgramScheduleEditableRange): string {
  const start = dateKey(range.startAt);
  const end = dateKey(range.endAt);
  if (start === null || end === null) return '날짜를 선택해 주세요.';
  return `${formatKoreanDate(start)} → ${formatKoreanDate(end)}`;
}

function selectionDescription(
  range: ProgramScheduleEditableRange,
  anchorDate: string | null,
): string {
  if (anchorDate !== null)
    return `${formatKoreanDate(anchorDate)}을 시작일로 선택했습니다. 마감 날짜를 선택해 주세요.`;
  const start = dateKey(range.startAt);
  const end = dateKey(range.endAt);
  if (start === null || end === null)
    return '달력에서 시작 날짜를 선택해 주세요.';
  return `${formatKoreanDate(start)} ${timePart(range.startAt)}부터 ${formatKoreanDate(end)} ${timePart(range.endAt)}까지입니다.`;
}

function clampDateToRange(
  value: string,
  range: ProgramScheduleEditableRange | undefined,
): string {
  if (range?.minDate !== undefined && value < range.minDate)
    return range.minDate;
  if (range?.maxDate !== undefined && value > range.maxDate)
    return range.maxDate;
  return value;
}
