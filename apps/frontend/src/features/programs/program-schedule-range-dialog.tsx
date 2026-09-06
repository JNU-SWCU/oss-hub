'use client';

import { useId, useState } from 'react';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ProgramAuthoringDialog } from './program-authoring-dialog';
import {
  dateKey,
  monthKeyForEvents,
  type ProgramScheduleCalendarEvent,
} from './program-schedule-calendar-model';
import { ProgramScheduleRangeCalendar } from './program-schedule-range-calendar';
import {
  planRangeDateSelection,
  timePart,
} from './program-schedule-range-selection';
import type { ProgramScheduleEditableRange } from './program-schedule-range-types';

export function ProgramScheduleRangeDialog({
  range,
  description,
  confirmLabel = '저장',
  showCalendar = false,
  calendarEvents = [],
  onCancel,
  onSave,
}: {
  readonly range: ProgramScheduleEditableRange;
  readonly description?: string | null;
  readonly confirmLabel?: string;
  readonly showCalendar?: boolean;
  readonly calendarEvents?: readonly ProgramScheduleCalendarEvent[];
  readonly onCancel: () => void;
  readonly onSave: (
    startAt: string,
    endAt: string,
    endDisabled?: boolean,
  ) => void;
}) {
  const [startDate, setStartDate] = useState(dateKey(range.startAt) ?? '');
  const [endDate, setEndDate] = useState(dateKey(range.endAt) ?? '');
  const [startTime, setStartTime] = useState(timePart(range.startAt));
  const [endTime, setEndTime] = useState(timePart(range.endAt));
  const [endDisabled, setEndDisabled] = useState(Boolean(range.endDisabled));
  const [anchorDate, setAnchorDate] = useState<string | null>(null);
  const [monthKey, setMonthKey] = useState(() =>
    (
      dateKey(range.startAt) ??
      range.minDate ??
      monthKeyForEvents(calendarEvents)
    ).slice(0, 7),
  );
  const [focusedDate, setFocusedDate] = useState(
    () =>
      dateKey(range.startAt) ??
      range.minDate ??
      `${monthKeyForEvents(calendarEvents)}-01`,
  );
  const [attempted, setAttempted] = useState(false);
  const errorId = useId();
  const startAt = dateTime(startDate, startTime, '00:00');
  const endAt = endDisabled ? '' : dateTime(endDate, endTime, '23:59');
  const error =
    range.validate !== undefined
      ? range.validate(startAt, endAt, endDisabled)
      : rangeError(startAt, endAt, range.minDate, range.maxDate);
  const invalid = attempted && error !== null;
  const calendarRange = {
    ...range,
    startAt,
    endAt,
  };
  const visibleCalendarEvents = [
    ...calendarEvents.filter((event) => event.id !== range.id),
    ...(startAt && endAt
      ? [
          {
            id: range.id,
            label: range.label,
            kind: range.kind,
            startAt,
            endAt,
          },
        ]
      : []),
  ];

  function selectDate(date: string) {
    const selection = planRangeDateSelection({
      anchorDate,
      clickedDate: date,
      currentStartAt: startAt,
      currentEndAt: endAt,
    });
    setStartDate(dateKey(selection.startAt) ?? '');
    if (!endDisabled) setEndDate(dateKey(selection.endAt) ?? '');
    setAnchorDate(selection.anchorDate);
  }

  function save() {
    setAttempted(true);
    if (error !== null) return;
    if (range.endDisabled !== undefined) {
      onSave(startAt, endAt, endDisabled);
    } else {
      onSave(startAt, endAt);
    }
  }

  return (
    <ProgramAuthoringDialog
      title={range.label}
      description={
        description === undefined
          ? '시작과 종료 날짜·시간을 입력하세요.'
          : description
      }
      bodyClassName="gap-4"
      confirmLabel={confirmLabel}
      onCancel={onCancel}
      onSave={save}
    >
      {showCalendar ? (
        <ProgramScheduleRangeCalendar
          events={visibleCalendarEvents}
          activeRange={calendarRange}
          monthKey={monthKey}
          focusedDate={focusedDate}
          selectionInvalid={invalid}
          errorDescribedBy={invalid ? errorId : undefined}
          onMonthKeyChange={setMonthKey}
          onFocusedDateChange={setFocusedDate}
          onDateSelect={selectDate}
        />
      ) : null}
      <Field>
        <FieldLabel>시작</FieldLabel>
        <Input
          aria-label={`${range.label} 시작일`}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          type="date"
          min={range.minDate}
          max={range.maxDate}
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel>종료</FieldLabel>
        <Input
          aria-label={`${range.label} 종료일`}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          type="date"
          min={range.minDate}
          max={range.maxDate}
          value={endDate}
          disabled={endDisabled}
          onChange={(event) => setEndDate(event.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel>시작·마감 시각</FieldLabel>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-1">
            <FieldLabel
              className="text-small"
              htmlFor={`${range.id}-start-time`}
            >
              시작 시각
            </FieldLabel>
            <Input
              id={`${range.id}-start-time`}
              aria-label={`${range.label} 시작 시각`}
              aria-invalid={invalid}
              aria-describedby={invalid ? errorId : undefined}
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <FieldLabel className="text-small" htmlFor={`${range.id}-end-time`}>
              마감 시각
            </FieldLabel>
            <Input
              id={`${range.id}-end-time`}
              aria-label={`${range.label} 종료 시각`}
              aria-invalid={invalid}
              aria-describedby={invalid ? errorId : undefined}
              type="time"
              value={endTime}
              disabled={endDisabled}
              onChange={(event) => setEndTime(event.target.value)}
            />
          </div>
        </div>
      </Field>
      {range.endDisabled !== undefined ? (
        <Field orientation="horizontal">
          <input
            id={
              range.id === 'operation'
                ? 'program-end-at-undecided'
                : `${range.id}-end-undecided`
            }
            type="checkbox"
            checked={endDisabled}
            onChange={(event) => setEndDisabled(event.target.checked)}
          />
          <FieldLabel
            htmlFor={
              range.id === 'operation'
                ? 'program-end-at-undecided'
                : `${range.id}-end-undecided`
            }
          >
            종료일 미정
          </FieldLabel>
        </Field>
      ) : null}
      <FieldError id={errorId}>{attempted ? error : null}</FieldError>
    </ProgramAuthoringDialog>
  );
}

function dateTime(date: string, time: string, fallback: string): string {
  return date === '' ? '' : `${date}T${time || fallback}`;
}

function rangeError(
  startAt: string,
  endAt: string,
  minDate?: string,
  maxDate?: string,
): string | null {
  if (startAt === '' || endAt === '') return '시작과 종료를 입력해 주세요.';
  if (Date.parse(startAt) >= Date.parse(endAt))
    return '종료는 시작보다 늦어야 합니다.';
  const startDate = dateKey(startAt);
  const endDate = dateKey(endAt);
  if (
    startDate === null ||
    endDate === null ||
    (minDate !== undefined && startDate < minDate) ||
    (maxDate !== undefined && endDate > maxDate)
  )
    return '허용된 기간 안에서 선택해 주세요.';
  return null;
}
