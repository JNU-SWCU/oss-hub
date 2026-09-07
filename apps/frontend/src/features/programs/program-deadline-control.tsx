'use client';

import { BellRing, Eye, Send } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  DeadlinePreviewBodies,
  DeadlinePreviewCounts,
} from './program-deadline-preview';
import { useProgramDeadlinePreview } from './use-program-deadline-preview';

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
  const state = useProgramDeadlinePreview(
    programId,
    enabled && persistedEnabled,
  );
  const { preview, result, busy, error } = state;
  const toggleId =
    programId === undefined
      ? 'authoring-deadline-notification'
      : 'program-deadline-notification';
  const fields = [
    { key: 'studentGuidance', label: '학생용 추가 안내' },
    { key: 'staffGuidance', label: '교직원용 추가 안내' },
  ] as const;

  return (
    <div className="grid min-w-0 gap-4" data-testid="program-deadline-control">
      <Field orientation="horizontal">
        <input
          id={toggleId}
          type="checkbox"
          checked={enabled}
          disabled={busy === 'send'}
          onChange={(event) => onEnabledChange(event.target.checked)}
        />
        <div className="grid gap-1">
          <FieldLabel htmlFor={toggleId}>제출 마감 알림</FieldLabel>
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
        <div className="grid min-w-0 gap-6">
          {preview ? <DeadlinePreviewCounts preview={preview} /> : null}
          <section aria-label="이번 발송 안내" className="grid min-w-0 gap-4">
            <h3 className="font-semibold">이번 발송 안내</h3>
            <div className="grid min-w-0 gap-4 lg:grid-cols-2">
              {fields.map(({ key, label }) => (
                <Field key={key}>
                  <FieldLabel htmlFor={key}>{label}</FieldLabel>
                  <textarea
                    className="w-full min-w-0 rounded-control border border-input bg-background px-3 py-2 text-small focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    id={key}
                    aria-label={label}
                    aria-describedby={`${key}-count`}
                    aria-invalid={state.guidance[key].length > 4000}
                    value={state.guidance[key]}
                    disabled={busy === 'send'}
                    maxLength={4000}
                    rows={4}
                    onChange={(event) =>
                      state.changeGuidance(key, event.target.value)
                    }
                  />
                  <p
                    id={`${key}-count`}
                    className="text-small text-muted-foreground"
                  >
                    {state.guidance[key].length.toLocaleString('ko-KR')} /
                    4,000자
                  </p>
                </Field>
              ))}
            </div>
          </section>
          {state.needsRefresh && preview === null ? (
            <p role="status" className="text-small text-muted-foreground">
              현재 안내와 대상으로 다시 미리본 뒤 보낼 수 있습니다.
            </p>
          ) : null}
          <DeadlinePreviewBodies preview={preview} />
          {result ? (
            <Alert>
              <BellRing aria-hidden="true" />
              <AlertTitle>학생 {result.sentCount}명에게 보냈습니다.</AlertTitle>
              <AlertDescription>
                학생 중복 생략 {result.duplicateCount}명 · 학생 발송 실패{' '}
                {result.failedCount}명. 교직원 발송 결과는 이 수에 포함되지
                않습니다.
              </AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>마감 알림을 처리하지 못했습니다</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null || state.invalidGuidance}
              onClick={() => void state.loadPreview()}
            >
              <Eye aria-hidden="true" />
              {busy === 'preview'
                ? '계산 중…'
                : state.needsRefresh || preview !== null
                  ? '다시 미리보기'
                  : '발송 대상 미리보기'}
            </Button>
            <Button
              type="button"
              disabled={
                preview === null ||
                busy !== null ||
                state.invalidGuidance ||
                preview.recipientCount + preview.staffRecipientCount === 0
              }
              onClick={() => void state.send()}
            >
              <Send aria-hidden="true" />
              {busy === 'send' ? '보내는 중…' : '안내 보내기'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
