'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { DialogShell } from '@/components';
import { ApiError } from '@/lib/api-client';
import {
  previewProgramDeadline,
  sendProgramDeadline,
} from './program-deadline-api';
import type {
  ProgramDeadlineGuidance,
  ProgramDeadlinePreview,
  ProgramDeadlineSendResult,
} from './program-deadline-dto';
import {
  DeadlinePreviewBodies,
  DeadlinePreviewCounts,
} from './program-deadline-preview';

const GUIDANCE_LIMIT = 4000;
type Busy = 'preview' | 'send' | null;

export function DeadlineDigestDialog({
  programId,
  returnFocusRef,
  onClose,
}: {
  readonly programId: string;
  readonly returnFocusRef: RefObject<HTMLButtonElement | null>;
  readonly onClose: () => void;
}) {
  const [guidance, setGuidance] = useState<ProgramDeadlineGuidance>({
    studentGuidance: '',
    staffGuidance: '',
  });
  const [preview, setPreview] = useState<ProgramDeadlinePreview | null>(null);
  const [result, setResult] = useState<ProgramDeadlineSendResult | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const studentGuidanceRef = useRef<HTMLTextAreaElement>(null);
  const focusGuidanceOnRender = useRef(false);
  const sendInFlight = useRef(false);

  const invalidGuidance =
    guidance.studentGuidance.length > GUIDANCE_LIMIT ||
    guidance.staffGuidance.length > GUIDANCE_LIMIT;

  const loadPreview = useCallback(async () => {
    if (invalidGuidance || busy !== null) return;
    setBusy('preview');
    setError(null);
    try {
      setPreview(await previewProgramDeadline(programId, guidance));
      setResult(null);
    } catch (caught: unknown) {
      setError(deadlineErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }, [busy, guidance, invalidGuidance, programId]);

  useEffect(() => {
    if (preview === null || result !== null || busy !== null) return;
    queueMicrotask(() => editButtonRef.current?.focus());
  }, [busy, preview, result]);

  useEffect(() => {
    if (preview !== null || !focusGuidanceOnRender.current) return;
    focusGuidanceOnRender.current = false;
    queueMicrotask(() => studentGuidanceRef.current?.focus());
  }, [preview]);

  useEffect(() => {
    if (preview === null || busy === 'send') return;
    const remaining = new Date(preview.expiresAt).getTime() - Date.now();
    const timer = setTimeout(
      () => {
        focusGuidanceOnRender.current = true;
        setPreview(null);
        setError('미리보기가 만료되었습니다. 다시 미리보세요.');
      },
      Math.max(0, remaining),
    );
    return () => clearTimeout(timer);
  }, [busy, preview]);

  const changeGuidance = (
    field: keyof ProgramDeadlineGuidance,
    value: string,
  ) => {
    setGuidance((current) => ({ ...current, [field]: value }));
    setPreview(null);
    setResult(null);
    setError(null);
  };

  const edit = () => {
    focusGuidanceOnRender.current = true;
    setPreview(null);
    setError(null);
  };

  const send = async () => {
    if (preview === null || busy !== null || sendInFlight.current) return;
    if (new Date(preview.expiresAt).getTime() <= Date.now()) {
      focusGuidanceOnRender.current = true;
      setPreview(null);
      setError('미리보기가 만료되었습니다. 다시 미리보세요.');
      return;
    }
    sendInFlight.current = true;
    setBusy('send');
    setError(null);
    try {
      const sent = await sendProgramDeadline(programId, {
        previewedAt: preview.previewedAt,
        previewVersion: preview.previewVersion,
        ...guidance,
      });
      setResult(sent);
      setPreview(null);
    } catch (caught: unknown) {
      setPreview(null);
      setError(deadlineErrorMessage(caught));
    } finally {
      sendInFlight.current = false;
      setBusy(null);
    }
  };

  const recipientTotal =
    preview === null ? 0 : preview.recipientCount + preview.staffRecipientCount;
  const footer = result ? (
    <Button type="button" onClick={onClose}>
      닫기
    </Button>
  ) : preview ? (
    <div className="grid w-full gap-3">
      <p
        role="status"
        className="text-small text-center font-semibold whitespace-nowrap sm:text-right"
      >
        학생 {preview.recipientCount}명 · 교직원 {preview.staffRecipientCount}명
        · 발송 후 취소 불가
      </p>
      <div className="flex justify-end gap-2">
        <Button
          ref={editButtonRef}
          type="button"
          variant="outline"
          disabled={busy !== null}
          onClick={edit}
        >
          수정
        </Button>
        <Button
          type="button"
          disabled={busy !== null || recipientTotal === 0}
          onClick={() => void send()}
        >
          {busy === 'send' ? '보내는 중…' : '보내기'}
        </Button>
      </div>
    </div>
  ) : (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={busy !== null}
        onClick={onClose}
      >
        취소
      </Button>
      <Button
        type="button"
        disabled={busy !== null || invalidGuidance}
        onClick={() => void loadPreview()}
      >
        {busy === 'preview' ? '미리보는 중…' : '미리보기'}
      </Button>
    </>
  );

  return (
    <DialogShell
      title="마감 알림 보내기"
      size="lg"
      busy={busy !== null}
      returnFocusRef={returnFocusRef}
      className="max-h-[calc(100dvh-2rem)]"
      bodyClassName="gap-6"
      onCancel={onClose}
      footer={footer}
    >
      {busy === 'preview' && preview === null ? (
        <Skeleton label="마감 알림 미리보는 중" className="grid gap-4">
          <SkeletonBlock className="h-36 rounded-card" />
          <SkeletonBlock className="h-80 rounded-card" />
        </Skeleton>
      ) : result ? (
        <Alert>
          <AlertTitle>학생 {result.sentCount}명에게 보냈습니다.</AlertTitle>
          <AlertDescription>
            학생 중복 생략 {result.duplicateCount}명 · 학생 발송 실패{' '}
            {result.failedCount}명 · 교직원 요약 수신{' '}
            {result.staffRecipientCount}명
          </AlertDescription>
        </Alert>
      ) : preview ? (
        <div className="grid gap-6">
          <DeadlinePreviewCounts preview={preview} />
          <DeadlinePreviewBodies preview={preview} />
        </div>
      ) : (
        <DeadlineGuidanceFields
          guidance={guidance}
          studentGuidanceRef={studentGuidanceRef}
          disabled={busy !== null}
          onChange={changeGuidance}
        />
      )}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>마감 알림을 처리하지 못했습니다</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </DialogShell>
  );
}

function DeadlineGuidanceFields({
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
            maxLength={GUIDANCE_LIMIT}
            aria-invalid={guidance[field.key].length > GUIDANCE_LIMIT}
            rows={8}
            onChange={(event) => onChange(field.key, event.target.value)}
          />
          <p className="text-small tabular-nums text-muted-foreground">
            {guidance[field.key].length} / {GUIDANCE_LIMIT}자
          </p>
        </Field>
      ))}
    </div>
  );
}

function deadlineErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.problem.status === 409)
      return '발송 대상이 바뀌었거나 미리보기가 만료되었습니다. 다시 미리보세요.';
    if (error.problem.status === 400)
      return '추가 안내를 각각 4,000자 이내로 입력하세요.';
    return error.problem.detail;
  }
  return '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}
