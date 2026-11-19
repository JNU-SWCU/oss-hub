'use client';

import type { RefObject } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api-client';
import type {
  ProgramDeadlineGuidance,
  ProgramDeadlinePreview,
  ProgramDeadlineSendResult,
} from './program-deadline-dto';
import {
  DeadlinePreviewBodies,
  DeadlinePreviewCounts,
} from './program-deadline-preview';

export const DEADLINE_GUIDANCE_LIMIT = 4000;
export type DeadlineDigestBusy = 'preview' | 'send' | null;

type DeadlineDigestFooterModel = {
  readonly result: ProgramDeadlineSendResult | null;
  readonly preview: ProgramDeadlinePreview | null;
  readonly busy: DeadlineDigestBusy;
  readonly invalidGuidance: boolean;
};

type DeadlineDigestFooterActions = {
  readonly close: () => void;
  readonly edit: () => void;
  readonly preview: () => void;
  readonly send: () => void;
};

export function isDeadlineGuidanceInvalid(
  guidance: ProgramDeadlineGuidance,
): boolean {
  return (
    guidance.studentGuidance.length > DEADLINE_GUIDANCE_LIMIT ||
    guidance.staffGuidance.length > DEADLINE_GUIDANCE_LIMIT
  );
}

export function DeadlineDigestResult({
  result,
}: {
  readonly result: ProgramDeadlineSendResult;
}) {
  return (
    <Alert>
      <AlertTitle>학생 {result.sentCount}명에게 보냈습니다.</AlertTitle>
      <AlertDescription>
        학생 중복 생략 {result.duplicateCount}명 · 학생 발송 실패{' '}
        {result.failedCount}명 · 교직원 요약 수신 {result.staffRecipientCount}명
      </AlertDescription>
    </Alert>
  );
}

export function DeadlineDigestPreview({
  preview,
}: {
  readonly preview: ProgramDeadlinePreview;
}) {
  return (
    <div className="grid gap-6">
      <DeadlinePreviewCounts preview={preview} />
      <DeadlinePreviewBodies preview={preview} />
    </div>
  );
}

export function DeadlineDigestFooter({
  model,
  editButtonRef,
  actions,
}: {
  readonly model: DeadlineDigestFooterModel;
  readonly editButtonRef: RefObject<HTMLButtonElement | null>;
  readonly actions: DeadlineDigestFooterActions;
}) {
  if (model.result !== null) {
    return (
      <Button type="button" onClick={actions.close}>
        닫기
      </Button>
    );
  }
  if (model.preview !== null) {
    const recipientTotal =
      model.preview.recipientCount + model.preview.staffRecipientCount;
    return (
      <div className="grid w-full gap-3">
        <p
          role="status"
          className="text-small text-center font-semibold whitespace-nowrap sm:text-right"
        >
          학생 {model.preview.recipientCount}명 · 교직원{' '}
          {model.preview.staffRecipientCount}명 · 발송 후 취소 불가
        </p>
        <div className="flex justify-end gap-2">
          <Button
            ref={editButtonRef}
            type="button"
            variant="outline"
            disabled={model.busy !== null}
            onClick={actions.edit}
          >
            수정
          </Button>
          <Button
            type="button"
            disabled={model.busy !== null || recipientTotal === 0}
            onClick={actions.send}
          >
            {model.busy === 'send' ? '보내는 중…' : '보내기'}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={model.busy !== null}
        onClick={actions.close}
      >
        취소
      </Button>
      <Button
        type="button"
        disabled={model.busy !== null || model.invalidGuidance}
        onClick={actions.preview}
      >
        {model.busy === 'preview' ? '미리보는 중…' : '미리보기'}
      </Button>
    </>
  );
}

export function DeadlineGuidanceFields({
  guidance,
  studentGuidanceRef,
  disabled,
  onChange,
}: {
  readonly guidance: ProgramDeadlineGuidance;
  readonly studentGuidanceRef: RefObject<HTMLTextAreaElement | null>;
  readonly disabled: boolean;
  readonly onChange: (
    field: keyof ProgramDeadlineGuidance,
    value: string,
  ) => void;
}) {
  const fields = [
    {
      key: 'studentGuidance' as const,
      label: '학생용 추가 안내',
      ref: studentGuidanceRef,
    },
    {
      key: 'staffGuidance' as const,
      label: '교직원용 추가 안내',
      ref: undefined,
    },
  ];
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {fields.map((field) => (
        <Field key={field.key}>
          <FieldLabel htmlFor={`deadline-${field.key}`}>
            {field.label}
          </FieldLabel>
          <Textarea
            ref={field.ref}
            id={`deadline-${field.key}`}
            value={guidance[field.key]}
            disabled={disabled}
            maxLength={DEADLINE_GUIDANCE_LIMIT}
            aria-invalid={guidance[field.key].length > DEADLINE_GUIDANCE_LIMIT}
            rows={8}
            onChange={(event) => onChange(field.key, event.target.value)}
          />
          <p className="text-small tabular-nums text-muted-foreground">
            {guidance[field.key].length} / {DEADLINE_GUIDANCE_LIMIT}자
          </p>
        </Field>
      ))}
    </div>
  );
}

export function deadlineErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.problem.status === 409)
      return '발송 대상이 바뀌었거나 미리보기가 만료되었습니다. 다시 미리보세요.';
    if (error.problem.status === 400)
      return '추가 안내를 각각 4,000자 이내로 입력하세요.';
    return error.problem.detail;
  }
  return '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}
