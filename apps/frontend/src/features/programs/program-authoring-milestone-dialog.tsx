'use client';

import { useState } from 'react';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ProgramAuthoringDialog } from './program-authoring-dialog';
import type { ProgramAuthoringMilestone } from './program-authoring-model';
import { ProgramAuthoringSubmissionItem } from './program-authoring-submission-item';
import { ProgramAuthoringSortableAttachments } from './program-authoring-sortable-attachments';
import { dateKey } from './program-schedule-calendar-model';
import { validateTemplateFile } from './program-authoring-validation';

export function ProgramAuthoringMilestoneDialog({
  milestone,
  operationStartAt,
  operationEndAt,
  isNew,
  initialValidationVisible,
  onFieldChange,
  onAddAttachment,
  onAttachmentFileChange,
  onAttachmentRemove,
  onAttachmentRequiredChange,
  onAttachmentReorder,
  onAttachmentNameChange,
  onCancel,
  onSave,
}: {
  readonly milestone: ProgramAuthoringMilestone;
  readonly operationStartAt: string;
  readonly operationEndAt: string;
  readonly isNew: boolean;
  readonly initialValidationVisible: boolean;
  readonly onFieldChange: (
    field: 'name' | 'startAt' | 'dueAt' | 'instructions',
    value: string,
  ) => void;
  readonly onAddAttachment: (file: File) => void;
  readonly onAttachmentFileChange: (
    requirementId: string,
    file: File | null,
  ) => void;
  readonly onAttachmentRemove: (requirementId: string) => void;
  readonly onAttachmentRequiredChange: (
    requirementId: string,
    required: boolean,
  ) => void;
  readonly onAttachmentReorder: (requirementIds: readonly string[]) => void;
  readonly onAttachmentNameChange: (
    requirementId: string,
    name: string,
  ) => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
}) {
  const [saveAttempted, setSaveAttempted] = useState(initialValidationVisible);
  const [fileError, setFileError] = useState<string | null>(null);
  const startDate = dateKey(milestone.startAt) ?? '';
  const dueDate = dateKey(milestone.dueAt) ?? '';
  const minDate = dateKey(operationStartAt) ?? undefined;
  const maxDate = dateKey(operationEndAt) ?? undefined;
  const errors = validationErrors(milestone, operationStartAt, operationEndAt);

  function acceptFile(file: File, onValid: (value: File) => void) {
    const error = validateTemplateFile(file);
    setFileError(error);
    if (error === null) onValid(file);
  }

  function save() {
    setSaveAttempted(true);
    if (errors.name || errors.period || errors.attachments) return;
    onSave();
  }

  return (
    <ProgramAuthoringDialog
      size="lg"
      title={isNew ? '마일스톤 추가' : '마일스톤 수정'}
      description="운영 기간 안에서 일정과 공지, 첨부파일을 작성하세요."
      onCancel={onCancel}
      onSave={save}
    >
      <Field>
        <FieldLabel>기간 *</FieldLabel>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            aria-label="시작일"
            aria-invalid={saveAttempted && Boolean(errors.period)}
            type="date"
            min={minDate}
            max={maxDate}
            value={startDate}
            onChange={(event) =>
              onFieldChange('startAt', dateTime(event.target.value, '00:00'))
            }
          />
          <Input
            aria-label="마감일"
            aria-invalid={saveAttempted && Boolean(errors.period)}
            type="date"
            min={minDate}
            max={maxDate}
            value={dueDate}
            onChange={(event) =>
              onFieldChange('dueAt', dateTime(event.target.value, '23:59'))
            }
          />
        </div>
        <FieldError>{saveAttempted ? errors.period : null}</FieldError>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${milestone.id}-name`}>
          마일스톤 이름 *
        </FieldLabel>
        <Input
          id={`${milestone.id}-name`}
          aria-invalid={saveAttempted && Boolean(errors.name)}
          value={milestone.name}
          onChange={(event) => onFieldChange('name', event.target.value)}
        />
        <FieldError>{saveAttempted ? errors.name : null}</FieldError>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${milestone.id}-notice`}>공지사항</FieldLabel>
        <textarea
          id={`${milestone.id}-notice`}
          className="min-h-28 rounded-control border border-input bg-transparent p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={milestone.instructions}
          onChange={(event) =>
            onFieldChange('instructions', event.target.value)
          }
        />
      </Field>
      <Field>
        <FieldLabel>첨부파일</FieldLabel>
        <div className="grid gap-3">
          <ProgramAuthoringSortableAttachments
            milestoneId={milestone.id}
            requirements={milestone.requirements}
            onReorder={onAttachmentReorder}
          >
            {(requirement, reorderHandle) => (
              <ProgramAuthoringSubmissionItem
                milestoneId={milestone.id}
                requirement={requirement}
                reorderHandle={reorderHandle}
                onFileChange={(_, requirementId, file) => {
                  if (file === null) {
                    onAttachmentFileChange(requirementId, null);
                    return;
                  }
                  acceptFile(file, (valid) =>
                    onAttachmentFileChange(requirementId, valid),
                  );
                }}
                onRemove={(_, requirementId) =>
                  onAttachmentRemove(requirementId)
                }
                onRequiredChange={(_, requirementId, required) =>
                  onAttachmentRequiredChange(requirementId, required)
                }
                onNameChange={(_, requirementId, name) =>
                  onAttachmentNameChange(requirementId, name)
                }
              />
            )}
          </ProgramAuthoringSortableAttachments>
          <label className="ml-auto w-fit cursor-pointer text-small font-semibold text-primary underline-offset-4 hover:underline focus-within:ring-2 focus-within:ring-ring">
            첨부파일 추가
            <input
              className="sr-only"
              aria-label="첨부파일 추가"
              type="file"
              accept=".pdf,.hwp,.jpg,.jpeg,.png,.zip"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) acceptFile(file, onAddAttachment);
                event.target.value = '';
              }}
            />
          </label>
        </div>
        <FieldError>{fileError}</FieldError>
        <FieldError>{saveAttempted ? errors.attachments : null}</FieldError>
      </Field>
    </ProgramAuthoringDialog>
  );
}

function dateTime(date: string, time: string): string {
  return date ? `${date}T${time}` : '';
}

function validationErrors(
  milestone: ProgramAuthoringMilestone,
  operationStartAt: string,
  operationEndAt: string,
): {
  readonly name: string | null;
  readonly period: string | null;
  readonly attachments: string | null;
} {
  const start = dateKey(milestone.startAt);
  const due = dateKey(milestone.dueAt);
  const startTime = Date.parse(milestone.startAt);
  const dueTime = Date.parse(milestone.dueAt);
  const operationStartTime = Date.parse(operationStartAt);
  const operationEndTime = Date.parse(operationEndAt);
  let period: string | null = null;
  if (!start || !due) period = '기간을 입력해 주세요.';
  else if (startTime >= dueTime) period = '마감일은 시작일 이후여야 합니다.';
  else if (
    (Number.isFinite(operationStartTime) && startTime < operationStartTime) ||
    (Number.isFinite(operationEndTime) && dueTime > operationEndTime)
  )
    period = '기간은 운영 기간 안에 있어야 합니다.';
  return {
    name: milestone.name.trim() ? null : '마일스톤 이름을 입력해 주세요.',
    period,
    attachments: milestone.requirements.some(
      (requirement) => requirement.name.trim() === '',
    )
      ? '제출물 이름을 입력해 주세요.'
      : milestone.requirements.some(
            (requirement) =>
              requirement.templateFile === null ||
              requirement.templateFile.requiresReselection,
          )
        ? '첨부파일을 다시 선택해 주세요.'
        : null,
  };
}
