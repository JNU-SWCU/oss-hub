'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { FormSection } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  classifyNotificationApiError,
  updateMyNotificationEmail,
} from '../api';
import { isValidNotificationEmail } from '../notification-settings-state';
import type { NotificationSettings } from '../types';

interface NotificationSettingsModalProps {
  readonly open: boolean;
  readonly initialSettings: NotificationSettings;
  readonly onClose: () => void;
  readonly onSaved?: (settings: NotificationSettings) => void;
}

/**
 * #127 수신 이메일 설정 모달(도메인 위젯). 진입 연결은 운영 대시보드(#117) 병합 후 잇는다.
 * 발송 스케줄러·메일 발송 로직은 건드리지 않고, 설정 값만 저장한다.
 */
export function NotificationSettingsModal({
  open,
  initialSettings,
  onClose,
  onSaved,
}: NotificationSettingsModalProps) {
  const [email, setEmail] = useState(initialSettings.notificationEmail ?? '');
  const [notifyEnabled, setNotifyEnabled] = useState(
    initialSettings.notifyEnabled,
  );
  const [showError, setShowError] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail(initialSettings.notificationEmail ?? '');
      setNotifyEnabled(initialSettings.notifyEnabled);
      setShowError(false);
      setSubmitError(null);
      setSaved(false);
    }
  }, [open, initialSettings]);

  if (!open) {
    return null;
  }

  const emailValid = isValidNotificationEmail(email);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setShowError(true);
    setSaved(false);
    if (!emailValid || isSaving) {
      return;
    }
    setIsSaving(true);
    setSubmitError(null);
    try {
      const updated = await updateMyNotificationEmail({
        notificationEmail: email.trim(),
        notifyEnabled,
      });
      setSaved(true);
      onSaved?.(updated);
    } catch (error: unknown) {
      switch (classifyNotificationApiError(error)) {
        case 'unauthorized':
          setSubmitError('로그인이 필요합니다.');
          break;
        case 'forbidden':
          setSubmitError('교직원만 알림 설정을 변경할 수 있습니다.');
          break;
        case 'not-found':
        case 'generic':
          setSubmitError('잠시 후 다시 시도해 주세요.');
          break;
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="알림 수신 이메일 설정"
        className="w-full max-w-md rounded-xl border bg-background p-6 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <FormSection
            title="알림 수신 이메일 설정"
            description="마감 임박 알림 메일을 받을 이메일과 수신 여부를 설정합니다."
          >
            <Field data-invalid={(showError && !emailValid) || undefined}>
              <FieldLabel htmlFor="notification-email">수신 이메일</FieldLabel>
              <Input
                id="notification-email"
                name="notificationEmail"
                type="email"
                autoComplete="email"
                value={email}
                aria-invalid={showError && !emailValid}
                onChange={(event) => setEmail(event.target.value)}
              />
              {showError && !emailValid ? (
                <FieldError>이메일 형식이 올바르지 않습니다.</FieldError>
              ) : null}
            </Field>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="notifyEnabled"
                checked={notifyEnabled}
                onChange={(event) => setNotifyEnabled(event.target.checked)}
              />
              마감 임박 알림 받기
            </label>
          </FormSection>

          {saved ? (
            <Alert>
              <AlertTitle>저장되었습니다</AlertTitle>
              <AlertDescription>
                다음 발송부터 새 설정이 적용됩니다.
              </AlertDescription>
            </Alert>
          ) : null}

          {submitError ? (
            <Alert variant="destructive">
              <AlertTitle>저장하지 못했습니다</AlertTitle>
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              닫기
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? '저장 중…' : '저장'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
