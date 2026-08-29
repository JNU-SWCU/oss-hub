'use client';

import { useState } from 'react';
import { Dialog } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
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
  const startAt = dateTime(startDate, startTime, '00:00');
  const endAt = dateTime(endDate, endTime, '23:59');
  const error = rangeError(startAt, endAt, range.minDate, range.maxDate);

  function save() {
    setAttempted(true);
    if (error !== null) return;
    onSave(startAt, endAt);
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/35" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-card border border-border bg-background p-card shadow-xl outline-none">
          <Dialog.Title className="text-lg font-semibold">
            {range.label}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-small text-muted-foreground">
            시작과 종료 날짜·시간을 입력하세요.
          </Dialog.Description>
          <div className="mt-5 grid gap-4">
            <Field>
              <FieldLabel>시작</FieldLabel>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem]">
                <Input
                  aria-label={`${range.label} 시작일`}
                  aria-invalid={attempted && Boolean(error)}
                  type="date"
                  min={range.minDate}
                  max={range.maxDate}
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
                <Input
                  aria-label={`${range.label} 시작 시각`}
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
                  aria-invalid={attempted && Boolean(error)}
                  type="date"
                  min={range.minDate}
                  max={range.maxDate}
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
                <Input
                  aria-label={`${range.label} 종료 시각`}
                  type="time"
                  value={endTime}
                  onChange={(event) => setEndTime(event.target.value)}
                />
              </div>
            </Field>
            <FieldError>{attempted ? error : null}</FieldError>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              취소
            </Button>
            <Button type="button" onClick={save}>
              저장
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
