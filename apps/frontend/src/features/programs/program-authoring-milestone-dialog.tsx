'use client';

import { useEffect, useRef, useState } from 'react';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { DialogShell, FormErrorSummary } from '@/components';
import type { ProgramAuthoringMilestone } from './program-authoring-model';
import {
  ProgramAuthoringSubmissionItem,
  useSubmissionItemErrorCount,
} from './program-authoring-submission-item';
import { ProgramAuthoringSortableAttachments } from './program-authoring-sortable-attachments';
import { dateKey } from './program-schedule-calendar-model';
import { validateTemplateFile } from './program-authoring-validation';
import { ProgramMilestoneFields } from './program-milestone-fields';
import type { SubmissionUploadLimit } from '@/lib/submission-upload-policy';

export function ProgramAuthoringMilestoneDialog({
  fileUpload,
  milestone,
  operationStartAt,
  operationEndAt,
  isNew,
  initialValidationVisible,
  attachmentLimitMessage,
  attachmentValidationMessage,
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
  readonly fileUpload: SubmissionUploadLimit;
  readonly milestone: ProgramAuthoringMilestone;
  readonly operationStartAt: string;
  readonly operationEndAt: string;
  readonly isNew: boolean;
  readonly initialValidationVisible: boolean;
  readonly attachmentLimitMessage: string | null;
  readonly attachmentValidationMessage: string | null;
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
  const fileErrorId = `${milestone.id}-attachment-file-error`;
  const startDate = dateKey(milestone.startAt) ?? '';
  const dueDate = dateKey(milestone.dueAt) ?? '';
  const minDate = dateKey(operationStartAt) ?? undefined;
  const maxDate = dateKey(operationEndAt) ?? undefined;
  const errors = validationErrors(milestone, operationStartAt, operationEndAt);
  const [itemErrorCount, reportItemErrors] = useSubmissionItemErrorCount();
  // 창에 보이는 오류 줄 수 — R-16 상단 요약의 개수다. 기간은 시작·마감이 한 줄이고,
  // 제출물 칸이 이름을 고치는 동안 스스로 띄우는 오류는 그 칸이 알려 준다.
  const visibleErrorCount =
    [
      saveAttempted ? errors.name : null,
      saveAttempted ? errors.period : null,
      fileError,
      attachmentValidationMessage,
      saveAttempted ? errors.attachments : null,
    ].filter(Boolean).length + itemErrorCount;
  // DialogShell 은 본문 ref 를 내주지 않아, 레이아웃을 바꾸지 않는 `contents`
  // 감싸개로 저장 뒤 첫 오류 칸을 찾을 범위를 잡는다.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [focusRequest, setFocusRequest] = useState(0);

  useEffect(() => {
    if (focusRequest === 0) return;
    const firstInvalidField =
      bodyRef.current?.querySelector<HTMLElement>(
        '[aria-invalid="true"]:not(:disabled)',
      ) ?? null;
    firstInvalidField?.focus({ preventScroll: true });
    firstInvalidField?.scrollIntoView?.({ block: 'center' });
  }, [focusRequest]);

  function acceptFile(file: File, onValid: (value: File) => void) {
    const error = validateTemplateFile(file, fileUpload);
    setFileError(error);
    if (error === null) onValid(file);
  }

  function save() {
    setSaveAttempted(true);
    if (
      errors.name ||
      errors.period ||
      errors.attachments ||
      attachmentValidationMessage
    ) {
      setFocusRequest((count) => count + 1);
      return;
    }
    onSave();
  }

  return (
    <DialogShell
      size="lg"
      title={isNew ? '마일스톤 추가' : '마일스톤 수정'}
      description="운영 기간 안에서 일정과 공지, 첨부파일을 작성하세요."
      onCancel={onCancel}
      onSave={save}
    >
      <div ref={bodyRef} className="contents">
        <FormErrorSummary count={visibleErrorCount} />
        <ProgramMilestoneFields
          id={milestone.id}
          name={milestone.name}
          instructions={milestone.instructions}
          nameError={saveAttempted ? errors.name : null}
          schedule={
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
                    onFieldChange(
                      'startAt',
                      boundaryDateTime(
                        event.target.value,
                        operationStartAt,
                        '00:00',
                      ),
                    )
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
                    onFieldChange(
                      'dueAt',
                      boundaryDateTime(
                        event.target.value,
                        operationEndAt,
                        '23:59',
                      ),
                    )
                  }
                />
              </div>
              <FieldError>{saveAttempted ? errors.period : null}</FieldError>
            </Field>
          }
          onNameChange={(value) => onFieldChange('name', value)}
          onInstructionsChange={(value) => onFieldChange('instructions', value)}
        />
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
                  onVisibleErrorCountChange={reportItemErrors}
                />
              )}
            </ProgramAuthoringSortableAttachments>
            <label
              className={`ml-auto w-fit text-small font-semibold underline-offset-4 focus-within:ring-2 focus-within:ring-ring ${attachmentLimitMessage === null ? 'cursor-pointer text-primary hover:underline' : 'cursor-not-allowed text-muted-foreground'}`}
            >
              첨부파일 추가
              <input
                className="sr-only"
                aria-label="첨부파일 추가"
                aria-invalid={fileError !== null}
                aria-describedby={fileError ? fileErrorId : undefined}
                type="file"
                accept=".pdf,.hwp,.jpg,.jpeg,.png,.zip"
                disabled={attachmentLimitMessage !== null}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) acceptFile(file, onAddAttachment);
                  event.target.value = '';
                }}
              />
            </label>
            {attachmentLimitMessage ? (
              <p className="text-small text-muted-foreground" role="status">
                {attachmentLimitMessage}
              </p>
            ) : null}
            <p className="text-small text-muted-foreground">
              최대 {fileUpload.maxLabel}
            </p>
          </div>
          <FieldError id={fileErrorId}>{fileError}</FieldError>
          <FieldError>{attachmentValidationMessage}</FieldError>
          <FieldError>{saveAttempted ? errors.attachments : null}</FieldError>
        </Field>
      </div>
    </DialogShell>
  );
}

function boundaryDateTime(
  date: string,
  boundary: string,
  interiorTime: string,
): string {
  if (!date) return '';
  return dateKey(boundary) === date ? boundary : `${date}T${interiorTime}`;
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
