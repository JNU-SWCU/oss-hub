'use client';

import { useState } from 'react';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import type { EditableProgram } from './api';
import type {
  ProgramEditableField,
  ProgramEditErrors,
  ProgramEditForm,
} from './program-edit-flow';
import { dateKey } from './program-schedule-calendar-model';
import { ProgramScheduleRangeEditor } from './program-schedule-range-editor';
import type { ProgramScheduleEditableRange } from './program-schedule-range-types';
import { editScheduleEvents } from './program-schedule-overview-model';

export function ProgramEditScheduleEditor({
  program,
  form,
  errors,
  onFieldChange,
}: {
  readonly program: EditableProgram;
  readonly form: ProgramEditForm;
  readonly errors: ProgramEditErrors;
  readonly onFieldChange: (
    field: ProgramEditableField,
    value: string | boolean,
  ) => void;
}) {
  const [activeId, setActiveId] = useState('application');
  const visibleActiveId =
    errors.startAt || errors.endAt
      ? 'operation'
      : errors.period
        ? 'application'
        : activeId;
  const ranges: readonly ProgramScheduleEditableRange[] = [
    {
      id: 'application',
      label: '신청 기간',
      kind: 'APPLICATION',
      startAt: form.applicationStartAt,
      endAt: form.applicationEndAt,
      maxDate: form.endAtUndecided
        ? undefined
        : (dateKey(form.endAt) ?? undefined),
      startInputId: 'program-application-start-at',
      endInputId: 'program-application-end-at',
      startError: errors.period,
      endError: errors.period,
      onStartAtChange: (value) => onFieldChange('applicationStartAt', value),
      onEndAtChange: (value) => onFieldChange('applicationEndAt', value),
    },
    {
      id: 'operation',
      label: '운영 기간',
      kind: 'OPERATION',
      startAt: form.startAt,
      endAt: form.endAtUndecided ? '' : form.endAt,
      startInputId: 'program-start-at',
      endInputId: 'program-end-at',
      startError: errors.startAt,
      endError: errors.endAt,
      endDisabled: form.endAtUndecided,
      onStartAtChange: (value) => onFieldChange('startAt', value),
      onEndAtChange: (value) => {
        if (!form.endAtUndecided) onFieldChange('endAt', value);
      },
    },
  ];

  return (
    <ProgramScheduleRangeEditor
      ranges={ranges}
      activeId={activeId}
      validationActiveId={
        errors.startAt || errors.endAt
          ? 'operation'
          : errors.period
            ? 'application'
            : null
      }
      onActiveIdChange={setActiveId}
      contextEvents={editScheduleEvents(form, program.milestones, {
        mode: 'closed',
      })}
      activeExtra={
        visibleActiveId === 'operation' ? (
          <UndecidedEndField
            checked={form.endAtUndecided}
            onChange={(checked) => onFieldChange('endAtUndecided', checked)}
          />
        ) : null
      }
    />
  );
}

function UndecidedEndField({
  checked,
  onChange,
}: {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <Field className="rounded-card border border-border bg-background p-4">
      <Field orientation="horizontal">
        <input
          id="program-end-at-undecided"
          type="checkbox"
          checked={checked}
          aria-describedby="program-end-at-help"
          onChange={(event) => onChange(event.target.checked)}
        />
        <FieldLabel htmlFor="program-end-at-undecided">종료일 미정</FieldLabel>
      </Field>
      <FieldDescription id="program-end-at-help">
        운영 종료일을 아직 정하지 않았다면 선택하세요. 나중에 체크를 풀고
        달력에서 종료일을 고를 수 있습니다.
      </FieldDescription>
    </Field>
  );
}
