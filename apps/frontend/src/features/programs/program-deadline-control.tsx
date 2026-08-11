'use client';

import { BellRing, Eye, Send } from 'lucide-react';
import { useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { ApiError } from '@/lib/api-client';
import {
  previewProgramDeadline,
  sendProgramDeadline,
  type ProgramDeadlinePreview,
  type ProgramDeadlineSendResult,
} from './program-deadline-api';

export function ProgramDeadlineControl({
  enabled,
  onEnabledChange,
  programId,
  persistedEnabled = false,
}: {
  readonly enabled: boolean;
  readonly onEnabledChange: (enabled: boolean) => void;
  readonly programId?: string;
  readonly persistedEnabled?: boolean;
}) {
  const [preview, setPreview] = useState<ProgramDeadlinePreview | null>(null);
  const [result, setResult] = useState<ProgramDeadlineSendResult | null>(null);
  const [busy, setBusy] = useState<'preview' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPreview = async () => {
    if (programId === undefined) return;
    setBusy('preview');
    setError(null);
    setResult(null);
    try {
      setPreview(await previewProgramDeadline(programId));
    } catch (caught: unknown) {
      setPreview(null);
      setError(deadlineErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    if (programId === undefined || preview === null) return;
    setBusy('send');
    setError(null);
    try {
      setResult(
        await sendProgramDeadline(programId, {
          previewedAt: preview.previewedAt,
          previewVersion: preview.previewVersion,
        }),
      );
    } catch (caught: unknown) {
      if (caught instanceof ApiError && caught.problem.status === 409) {
        setPreview(null);
      }
      setError(deadlineErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-4">
      <Field orientation="horizontal">
        <input
          id={
            programId === undefined
              ? 'authoring-deadline-notification'
              : 'program-deadline-notification'
          }
          type="checkbox"
          checked={enabled}
          onChange={(event) => {
            setPreview(null);
            setResult(null);
            setError(null);
            onEnabledChange(event.target.checked);
          }}
        />
        <div className="grid gap-1">
          <FieldLabel
            htmlFor={
              programId === undefined
                ? 'authoring-deadline-notification'
                : 'program-deadline-notification'
            }
          >
            제출 마감 알림
          </FieldLabel>
          <p className="text-small text-muted-foreground">
            켜면 마감까지 24시간 이내인 필수 서류의 미제출 참여자에게 알림을
            보냅니다.
          </p>
        </div>
      </Field>

      {!enabled ? (
        <p className="text-small text-muted-foreground">
          자동 알림과 프로그램별 수동 발송을 사용하지 않습니다.
        </p>
      ) : null}

      {enabled && programId !== undefined && !persistedEnabled ? (
        <Alert>
          <BellRing aria-hidden="true" />
          <AlertDescription>
            설정을 저장한 뒤 발송 대상을 미리볼 수 있습니다.
          </AlertDescription>
        </Alert>
      ) : null}

      {enabled && programId !== undefined && persistedEnabled ? (
        <div className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null}
              onClick={() => void loadPreview()}
            >
              <Eye aria-hidden="true" />
              {busy === 'preview' ? '계산 중…' : '발송 대상 미리보기'}
            </Button>
            <Button
              type="button"
              disabled={preview === null || busy !== null}
              onClick={() => void send()}
            >
              <Send aria-hidden="true" />
              {busy === 'send' ? '보내는 중…' : '알림 보내기'}
            </Button>
          </div>

          {preview ? <DeadlinePreviewCard preview={preview} /> : null}
          {result ? (
            <Alert>
              <BellRing aria-hidden="true" />
              <AlertTitle>{result.sentCount}명에게 보냈습니다.</AlertTitle>
              <AlertDescription>
                중복 생략 {result.duplicateCount}명 · 발송 실패{' '}
                {result.failedCount}명
              </AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>마감 알림을 처리하지 못했습니다</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DeadlinePreviewCard({
  preview,
}: {
  readonly preview: ProgramDeadlinePreview;
}) {
  const facts = [
    ['발송 가능', preview.recipientCount, '명'],
    ['수신 거부', preview.optedOutCount, '명'],
    ['비활성', preview.inactiveCount, '명'],
    ['이메일 없음', preview.noEmailCount, '명'],
    ['미제출 신청', preview.applicationCount, '건'],
    ['대상 마일스톤', preview.milestoneCount, '개'],
  ] as const;
  return (
    <Card>
      <CardContent className="pt-card">
        <dl className="grid grid-cols-2 gap-4 text-small lg:grid-cols-3">
          {facts.map(([label, count, unit]) => (
            <div
              key={label}
              className="grid gap-1"
              aria-label={`${label} ${count}${unit}`}
            >
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-semibold">
                {count}
                {unit}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-small text-muted-foreground">
          미리보기는 10분 동안 유효하며, 대상이 바뀌면 다시 계산해야 합니다.
        </p>
      </CardContent>
    </Card>
  );
}

function deadlineErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.problem.status === 409) {
    return '발송 대상이 바뀌었거나 미리보기가 만료되었습니다. 다시 미리보세요.';
  }
  return '잠시 후 다시 시도해 주세요.';
}
