'use client';

import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { FieldError, FieldLabel } from '@/components/ui/field';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { EditableProgram } from './api';
import {
  type ProgramEditableField,
  type ProgramEditErrors,
  type ProgramEditForm,
  validateProgramEditForm,
} from './program-edit-flow';
import { dateKey } from './program-schedule-calendar-model';
import { ProgramScheduleRangeDialog } from './program-schedule-range-dialog';
import type { ProgramScheduleEditableRange } from './program-schedule-range-types';
import { formatKoreanDate, timePart } from './program-schedule-range-selection';
import { editScheduleEvents } from './program-schedule-overview-model';

type BasicScheduleRangeId = 'application' | 'operation';

type TriggerRefs = {
  application: HTMLButtonElement | null;
  operation: HTMLButtonElement | null;
};

export function ProgramEditScheduleEditor({
  program,
  form,
  errors,
  isSaving = false,
  onFieldChange,
}: {
  readonly program: EditableProgram;
  readonly form: ProgramEditForm;
  readonly errors: ProgramEditErrors;
  readonly isSaving?: boolean;
  readonly onFieldChange: (
    field: ProgramEditableField,
    value: string | boolean,
  ) => void;
}) {
  const [openRangeId, setOpenRangeId] = useState<BasicScheduleRangeId | null>(
    null,
  );
  const triggerRefs = useRef<TriggerRefs>({
    application: null,
    operation: null,
  });
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const applicationError = errors.period;
  const operationError = errors.startAt ?? errors.endAt;
  const ranges = {
    application: {
      id: 'application',
      label: '신청 기간',
      kind: 'APPLICATION' as const,
      startAt: form.applicationStartAt,
      endAt: form.applicationEndAt,
      maxDate: form.endAtUndecided
        ? undefined
        : (dateKey(form.endAt) ?? undefined),
      startInputId: 'program-application-start-at',
      endInputId: 'program-application-end-at',
      startError: applicationError,
      endError: applicationError,
      validate: (startAt: string, endAt: string) =>
        validateBasicScheduleRange(
          'application',
          form,
          program,
          startAt,
          endAt,
          false,
        ),
      onStartAtChange: (value: string) =>
        onFieldChange('applicationStartAt', value),
      onEndAtChange: (value: string) =>
        onFieldChange('applicationEndAt', value),
    },
    operation: {
      id: 'operation',
      label: '운영 기간',
      kind: 'OPERATION' as const,
      startAt: form.startAt,
      endAt: form.endAtUndecided ? '' : form.endAt,
      startInputId: 'program-start-at',
      endInputId: 'program-end-at',
      startError: errors.startAt,
      endError: errors.endAt,
      endDisabled: form.endAtUndecided,
      validate: (startAt: string, endAt: string, endDisabled: boolean) =>
        validateBasicScheduleRange(
          'operation',
          form,
          program,
          startAt,
          endAt,
          endDisabled,
        ),
      onStartAtChange: (value: string) => onFieldChange('startAt', value),
      onEndAtChange: (value: string) => onFieldChange('endAt', value),
    },
  } satisfies Record<BasicScheduleRangeId, ProgramScheduleEditableRange>;
  const openRange = openRangeId === null ? null : ranges[openRangeId];

  useEffect(() => {
    if (openRangeId !== null || returnFocusRef.current === null) return;
    returnFocusRef.current.focus();
    returnFocusRef.current = null;
  }, [openRangeId]);

  function closeRangeEditor() {
    const trigger =
      openRangeId === null ? null : triggerRefs.current[openRangeId];
    returnFocusRef.current = trigger;
    setOpenRangeId(null);
  }

  function applyRange(
    rangeId: BasicScheduleRangeId,
    startAt: string,
    endAt: string,
    endDisabled: boolean,
  ) {
    if (rangeId === 'application') {
      if (!sameLocalDateTime(form.applicationStartAt, startAt))
        onFieldChange('applicationStartAt', startAt);
      if (!sameLocalDateTime(form.applicationEndAt, endAt))
        onFieldChange('applicationEndAt', endAt);
    } else {
      if (!sameLocalDateTime(form.startAt, startAt))
        onFieldChange('startAt', startAt);
      if (form.endAtUndecided !== endDisabled)
        onFieldChange('endAtUndecided', endDisabled);
      if (!endDisabled && !sameLocalDateTime(form.endAt, endAt))
        onFieldChange('endAt', endAt);
    }
    closeRangeEditor();
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="grid gap-3" data-program-schedule-summaries>
        <ScheduleSummary
          range={ranges.application}
          error={applicationError}
          isSaving={isSaving}
          setTrigger={(target) => {
            triggerRefs.current.application = target;
          }}
          onOpen={() => setOpenRangeId('application')}
        />
        <ScheduleSummary
          range={ranges.operation}
          error={operationError}
          isSaving={isSaving}
          setTrigger={(target) => {
            triggerRefs.current.operation = target;
          }}
          onOpen={() => setOpenRangeId('operation')}
        />
        {openRange !== null && openRangeId !== null ? (
          <ProgramScheduleRangeDialog
            range={openRange}
            description="날짜를 적용한 뒤 프로그램 정보 저장을 눌러야 저장됩니다."
            confirmLabel="날짜 적용"
            dialogClassName="w-full px-3 py-3 sm:w-[calc(100%-2rem)] sm:px-card sm:py-card"
            bodyClassName="auto-rows-max"
            showCalendar
            showCalendarScrollHint={false}
            calendarEvents={editScheduleEvents(form, program.milestones, {
              mode: 'closed',
            })}
            onCancel={closeRangeEditor}
            onSave={(startAt, endAt, endDisabled = false) =>
              applyRange(openRangeId, startAt, endAt, endDisabled)
            }
          />
        ) : null}
      </div>
    </TooltipProvider>
  );
}

function ScheduleSummary({
  range,
  error,
  isSaving,
  setTrigger,
  onOpen,
}: {
  readonly range: ProgramScheduleEditableRange;
  readonly error?: string;
  readonly isSaving: boolean;
  readonly setTrigger: (target: HTMLButtonElement | null) => void;
  readonly onOpen: () => void;
}) {
  const errorId = `${range.id}-schedule-error`;
  const summary = scheduleSummary(
    range.startAt,
    range.endAt,
    Boolean(range.endDisabled),
  );

  return (
    <div className="grid gap-1" data-schedule-summary={range.id}>
      <div className="flex min-w-0 items-start gap-3 rounded-card border border-border bg-background p-4">
        <div className="min-w-0 flex-1">
          <FieldLabel className="font-semibold">{range.label}</FieldLabel>
          <p className="mt-1 break-keep text-small text-muted-foreground">
            {summary}
          </p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              ref={setTrigger}
              type="button"
              aria-label={`${range.label} 수정`}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
              disabled={isSaving}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              onClick={onOpen}
            >
              <Pencil aria-hidden="true" className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{`${range.label} 수정`}</TooltipContent>
        </Tooltip>
      </div>
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}

function scheduleSummary(
  startAt: string,
  endAt: string,
  endDisabled: boolean,
): string {
  const start = scheduleDateTime(startAt, '00:00');
  const end = endDisabled ? '종료일 미정' : scheduleDateTime(endAt, '23:59');
  return `${start} → ${end}`;
}

function scheduleDateTime(value: string, fallbackTime: string): string {
  const date = dateKey(value);
  if (date === null) return '날짜를 선택해 주세요.';
  return `${formatKoreanDate(date)} ${timePart(value, fallbackTime)}`;
}

function sameLocalDateTime(left: string, right: string): boolean {
  return dateKey(left) === dateKey(right) && timePart(left) === timePart(right);
}

function validateBasicScheduleRange(
  rangeId: BasicScheduleRangeId,
  form: ProgramEditForm,
  program: EditableProgram,
  startAt: string,
  endAt: string,
  endDisabled: boolean,
): string | null {
  const candidateForm: ProgramEditForm = {
    ...form,
    applicationStartAt:
      rangeId === 'application' ? startAt : form.applicationStartAt,
    applicationEndAt: rangeId === 'application' ? endAt : form.applicationEndAt,
    startAt: rangeId === 'operation' ? startAt : form.startAt,
    endAt: rangeId === 'operation' ? endAt : form.endAt,
    endAtUndecided: rangeId === 'operation' ? endDisabled : form.endAtUndecided,
    milestoneStartAts: program.milestones.map((milestone) => milestone.startAt),
    milestoneDueAts: program.milestones.map((milestone) => milestone.dueAt),
  };
  const errors = validateProgramEditForm(candidateForm);
  return rangeId === 'application'
    ? (errors.period ?? null)
    : (errors.startAt ?? errors.endAt ?? null);
}
