'use client';

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { CalendarClock, RotateCcw } from 'lucide-react';
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
import { ProgramScheduleRangeDialog } from './program-schedule-range-dialog';
import type { ProgramScheduleEditableRange } from './program-schedule-range-types';

export function ProgramScheduleRangeEditor({
  ranges,
  activeId,
  validationActiveId,
  onActiveIdChange,
  contextEvents = [],
  headerAction,
  activeExtra,
  layout = 'default',
}: {
  readonly ranges: readonly ProgramScheduleEditableRange[];
  readonly activeId: string;
  readonly validationActiveId?: string | null;
  readonly onActiveIdChange: (value: string) => void;
  readonly contextEvents?: readonly ProgramScheduleCalendarEvent[];
  readonly headerAction?: ReactNode;
  readonly activeExtra?: ReactNode;
  readonly layout?: 'default' | 'simple';
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
  const [timeControlsOpenFor, setTimeControlsOpenFor] = useState<string | null>(
    null,
  );
  const [manualRangeId, setManualRangeId] = useState<string | null>(null);
  const manualRange = ranges.find((range) => range.id === manualRangeId);
  const startDateErrorId = useId();
  const endDateErrorId = useId();

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

  const startDate = activeRange ? dateKey(activeRange.startAt) : null;
  const endDate = activeRange ? dateKey(activeRange.endAt) : null;
  const hasEnabledTimeError =
    (Boolean(activeRange?.startError) && startDate !== null) ||
    (Boolean(activeRange?.endError) &&
      endDate !== null &&
      !activeRange?.endDisabled);
  const timeControlsVisible =
    timeControlsOpenFor === activeRange?.id || hasEnabledTimeError;
  const startDateError =
    startDate === null ? activeRange?.startError : undefined;
  const endDateError = endDate === null ? activeRange?.endError : undefined;
  const dateErrorDescription = [
    startDateError ? startDateErrorId : null,
    endDateError ? endDateErrorId : null,
  ]
    .filter((id): id is string => id !== null)
    .join(' ');

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

  const timeControlsId = `${activeRange.id}-time-controls`;
  const simpleLayout = layout === 'simple';

  return (
    <Card className="overflow-hidden border-primary/30 bg-primary/5">
      {simpleLayout ? null : (
        <CardHeader className="gap-1">
          <CardTitle className="break-keep text-pretty">
            신청·운영·마일스톤 일정
          </CardTitle>
          <p className="break-keep text-small text-muted-foreground">
            정할 일정을 고른 뒤 같은 달력에서 시작일과 종료일을 차례로
            선택합니다.
          </p>
        </CardHeader>
      )}
      <CardContent
        className={
          simpleLayout
            ? 'grid min-w-0 gap-4'
            : 'grid gap-5 lg:grid-cols-[minmax(13rem,0.75fr)_minmax(0,1.5fr)]'
        }
      >
        {simpleLayout ? (
          <ProgramScheduleRangeCalendar
            events={events}
            activeRange={activeRange}
            monthKey={monthKey}
            focusedDate={focusedDate}
            errorDescribedBy={dateErrorDescription || undefined}
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
        ) : null}
        <div
          className={simpleLayout ? 'grid gap-2' : 'grid content-start gap-2'}
          aria-label={simpleLayout ? '일정 선택' : '일정 작성 순서'}
        >
          {ranges.map((range, index) => {
            const selected = range.id === activeRange.id;
            if (simpleLayout) {
              return (
                <div key={range.id} className="grid gap-2">
                  <div
                    data-schedule-range-row
                    data-invalid={Boolean(range.startError || range.endError)}
                    className={`flex min-h-16 items-center rounded-card border bg-background ${selected ? 'border-primary bg-primary/10 shadow-[inset_3px_0_0_var(--primary)]' : 'border-border hover:border-primary/60'}`}
                  >
                    <button
                      type="button"
                      aria-pressed={selected}
                      data-schedule-range-selector
                      className="min-w-0 flex-1 px-4 py-3 text-left break-keep text-pretty focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => {
                        setTimeControlsOpenFor(null);
                        onActiveIdChange(range.id);
                      }}
                    >
                      <strong className="text-small">{range.label}</strong>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {rangeSummary(range)}
                      </span>
                    </button>
                    <div className="mr-3 flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        aria-label={`${range.label} 일정 입력`}
                        title="일정 입력"
                        className="inline-flex size-9 items-center justify-center rounded-control text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => {
                          onActiveIdChange(range.id);
                          setManualRangeId(range.id);
                        }}
                      >
                        <CalendarClock aria-hidden="true" className="size-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`${range.label} 초기화`}
                        title="기간 초기화"
                        disabled={!range.startAt && !range.endAt}
                        className="inline-flex size-9 items-center justify-center rounded-control text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => {
                          onActiveIdChange(range.id);
                          setAnchorDate(null);
                          setTimeControlsOpenFor(null);
                          range.onStartAtChange('');
                          range.onEndAtChange('');
                        }}
                      >
                        <RotateCcw aria-hidden="true" className="size-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            }
            return (
              <button
                key={range.id}
                type="button"
                aria-pressed={selected}
                data-schedule-range-selector
                data-invalid={Boolean(range.startError || range.endError)}
                className={`min-h-16 rounded-card border px-4 py-3 text-left break-keep text-pretty focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'border-primary bg-primary/10 shadow-[inset_3px_0_0_var(--primary)]' : 'border-border bg-background hover:border-primary/60'}`}
                onClick={() => onActiveIdChange(range.id)}
              >
                <span className="flex items-center justify-between gap-2">
                  <strong className="text-small">
                    {`${index + 1}. ${range.label}`}
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
          {simpleLayout ? null : headerAction}
        </div>
        <div className="grid min-w-0 gap-4">
          {simpleLayout ? null : (
            <ProgramScheduleRangeCalendar
              events={events}
              activeRange={activeRange}
              monthKey={monthKey}
              focusedDate={focusedDate}
              errorDescribedBy={dateErrorDescription || undefined}
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
          )}
          <FieldError id={startDateErrorId}>{startDateError}</FieldError>
          <FieldError id={endDateErrorId}>{endDateError}</FieldError>
          <p className="sr-only" aria-live="polite">
            {selectionAnnouncement(activeRange, anchorDate)}
          </p>
          {simpleLayout ? null : activeExtra}
          {simpleLayout ? null : (
            <div>
              <button
                type="button"
                aria-expanded={timeControlsVisible}
                aria-controls={timeControlsId}
                className="text-small font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() =>
                  setTimeControlsOpenFor((current) =>
                    current === activeRange.id ? null : activeRange.id,
                  )
                }
              >
                시간 변경
              </button>
              {timeControlsVisible ? (
                <RangeTimeFields id={timeControlsId} range={activeRange} />
              ) : null}
            </div>
          )}
        </div>
        {manualRange ? (
          <ProgramScheduleRangeDialog
            range={manualRange}
            onCancel={() => setManualRangeId(null)}
            onSave={(startAt, endAt) => {
              manualRange.onStartAtChange(startAt);
              manualRange.onEndAtChange(endAt);
              setAnchorDate(null);
              setManualRangeId(null);
            }}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function RangeTimeFields({
  id,
  range,
}: {
  readonly id: string;
  readonly range: ProgramScheduleEditableRange;
}) {
  const startDate = dateKey(range.startAt);
  const endDate = dateKey(range.endAt);
  return (
    <Field
      id={id}
      className="rounded-card border border-border bg-background p-3"
    >
      <FieldLabel>시각 선택</FieldLabel>
      <div className="grid gap-3 sm:grid-cols-2">
        <TimeField
          id={range.startInputId}
          label="시작 시각"
          value={timePart(range.startAt)}
          disabled={startDate === null}
          error={startDate === null ? undefined : range.startError}
          onChange={(value) => {
            if (startDate !== null)
              range.onStartAtChange(
                dateTimeForDate(startDate, `${startDate}T${value}`, '00:00'),
              );
          }}
        />
        <TimeField
          id={range.endInputId}
          label="마감 시각"
          value={timePart(range.endAt)}
          disabled={endDate === null || Boolean(range.endDisabled)}
          error={endDate === null ? undefined : range.endError}
          onChange={(value) => {
            if (endDate !== null)
              range.onEndAtChange(
                dateTimeForDate(endDate, `${endDate}T${value}`, '23:59'),
              );
          }}
        />
      </div>
    </Field>
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

function selectionAnnouncement(
  range: ProgramScheduleEditableRange,
  anchorDate: string | null,
): string {
  if (anchorDate !== null)
    return '시작일을 선택했습니다. 마감일을 선택해 주세요.';
  const start = dateKey(range.startAt);
  const end = dateKey(range.endAt);
  if (start === null || end === null) return '시작일을 선택해 주세요.';
  return '기간을 선택했습니다.';
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
