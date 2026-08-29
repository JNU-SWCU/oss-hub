'use client';

import { useId, useState } from 'react';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ProgramAuthoringDialog } from './program-authoring-dialog';
import { dateKey } from './program-schedule-calendar-model';
import { timePart } from './program-schedule-range-selection';
import type { ProgramScheduleEditableRange } from './program-schedule-range-types';

export function ProgramScheduleRangeDialog({
  range,
  onCancel,
  onSave,
}: {
  readonly range: ProgramScheduleEditableRange;
  readonly onCancel: () => void;
  readonly onSave: (startAt: string, endAt: string) => void;
}) {
  const [startDate, setStartDate] = useState(dateKey(range.startAt) ?? '');
  const [endDate, setEndDate] = useState(dateKey(range.endAt) ?? '');
  const [startTime, setStartTime] = useState(timePart(range.startAt));
  const [endTime, setEndTime] = useState(timePart(range.endAt));
  const [attempted, setAttempted] = useState(false);
  const errorId = useId();
  const startAt = dateTime(startDate, startTime, '00:00');
  const endAt = dateTime(endDate, endTime, '23:59');
  const error = rangeError(startAt, endAt, range.minDate, range.maxDate);
  const invalid = attempted && error !== null;

  function save() {
    setAttempted(true);
    if (error !== null) return;
    onSave(startAt, endAt);
  }

  return (
    <ProgramAuthoringDialog
      title={range.label}
      description="시작과 종료 날짜·시간을 입력하세요."
      bodyClassName="gap-4"
      onCancel={onCancel}
      onSave={save}
    >
      <Field>
        <FieldLabel>시작</FieldLabel>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem]">
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
          <Input
            aria-label={`${range.label} 시작 시각`}
            aria-invalid={invalid}
            aria-describedby={invalid ? errorId : undefined}
            type="time"
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
          />
        </div>
      </Field>
      <Field>
        <FieldLabel>종료</FieldLabel>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <Input
            aria-label={`${range.label} 종료일`}
            aria-invalid={invalid}
            aria-describedby={invalid ? errorId : undefined}
            type="date"
            min={range.minDate}
            max={range.maxDate}
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
          />
          <Input
            aria-label={`${range.label} 종료 시각`}
            aria-invalid={invalid}
            aria-describedby={invalid ? errorId : undefined}
            type="time"
            value={endTime}
            onChange={(event) => setEndTime(event.target.value)}
          />
        </div>
      </Field>
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
