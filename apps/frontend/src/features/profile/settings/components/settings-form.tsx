import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  FormErrorSummary,
  FormSection,
  PageBody,
  PageHeader,
} from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { ProfileMemberKind } from '../../profile-requirements';
import type {
  SettingsFormErrors,
  SettingsFormValues,
  SettingsNotificationLoadState,
} from '../types';
import { AccountDeactivationSection } from './account-deactivation-section';
import {
  isStudentIdFieldShown,
  SettingsProfileSection,
} from './settings-profile-section';

interface SettingsFormProps {
  readonly memberKind: ProfileMemberKind | null;
  readonly hasAdminAccess: boolean;
  readonly values: SettingsFormValues;
  readonly errors: SettingsFormErrors;
  readonly showValidationErrors: boolean;
  readonly notificationLoad: SettingsNotificationLoadState;
  readonly isRetryingNotification: boolean;
  readonly isSubmitting: boolean;
  readonly submitError: string | null;
  readonly toastMessage: string | null;
  readonly onChange: (patch: Partial<SettingsFormValues>) => void;
  readonly onRetryNotification: () => void;
  readonly onSubmit: () => void;
}

export function SettingsSkeleton() {
  return (
    <PageBody className="max-w-2xl">
      <Skeleton label="설정을 불러오는 중" className="flex flex-col gap-12">
        <SkeletonBlock className="h-16 rounded-card" />
        <SkeletonBlock className="h-80 rounded-card" />
      </Skeleton>
    </PageBody>
  );
}

export function SettingsForm({
  memberKind,
  hasAdminAccess,
  values,
  errors,
  showValidationErrors,
  notificationLoad,
  isRetryingNotification,
  isSubmitting,
  submitError,
  toastMessage,
  onChange,
  onRetryNotification,
  onSubmit,
}: SettingsFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  // 저장을 누를 때마다 올린다. 칸의 aria-invalid 는 이 제출이 그리는 다음
  // 렌더에 붙으므로, 첫 오류 칸으로 옮기는 포커스(R-16)는 그 렌더 뒤에 한다.
  const [submitCount, setSubmitCount] = useState(0);

  useEffect(() => {
    if (submitCount === 0) return;
    const firstInvalidField =
      formRef.current?.querySelector<HTMLElement>(
        '[aria-invalid="true"]:not(:disabled)',
      ) ?? null;
    firstInvalidField?.focus({ preventScroll: true });
    firstInvalidField?.scrollIntoView?.({ block: 'center' });
  }, [submitCount]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setSubmitCount((count) => count + 1);
    onSubmit();
  }

  const showEmailError =
    showValidationErrors && errors.notificationEmail !== null;
  // R-16 상단 요약의 개수 — 화면에 보이는 오류 줄만 센다. 학번 칸이 감춰진
  // 동안의 학번 오류는 보이지 않으므로 빼고, 기타 소속 입력은 소속 줄 하나를
  // 함께 쓴다.
  const visibleErrorCount = showValidationErrors
    ? [
        errors.name,
        isStudentIdFieldShown(memberKind, values) ? errors.studentId : null,
        errors.phone,
        errors.department,
        errors.notificationEmail,
      ].filter(Boolean).length
    : 0;

  return (
    <PageBody className="max-w-2xl">
      <PageHeader
        title="설정"
        description="프로필과 알림 수신 설정을 관리합니다."
      />

      {toastMessage ? (
        <div
          role="status"
          className={cn(
            'rounded-card border border-status-approved-bg bg-status-approved-bg px-6 py-4',
            'text-small font-semibold text-status-approved-fg',
          )}
        >
          {toastMessage}
        </div>
      ) : null}

      <form
        ref={formRef}
        className="flex flex-col gap-16"
        noValidate
        onSubmit={handleSubmit}
      >
        <FormErrorSummary count={visibleErrorCount} />
        <SettingsProfileSection
          memberKind={memberKind}
          values={values}
          errors={errors}
          showValidationErrors={showValidationErrors}
          onChange={onChange}
        />

        <FormSection
          title="알림 수신"
          description="마감 임박 알림 메일을 받을 이메일과 수신 여부를 설정합니다."
        >
          {notificationLoad.kind === 'unavailable' ? (
            <Alert>
              <AlertTitle>알림 설정을 사용할 수 없습니다</AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-4">
                <span>{notificationLoad.message}</span>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isRetryingNotification}
                  onClick={onRetryNotification}
                >
                  {isRetryingNotification
                    ? '알림 설정 불러오는 중…'
                    : '알림 설정 다시 불러오기'}
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <Field data-invalid={showEmailError || undefined}>
                <FieldLabel htmlFor="settings-notification-email">
                  수신 이메일
                </FieldLabel>
                <Input
                  id="settings-notification-email"
                  name="notificationEmail"
                  type="email"
                  autoComplete="email"
                  value={values.notificationEmail}
                  aria-invalid={showEmailError}
                  aria-describedby={
                    showEmailError
                      ? 'settings-notification-email-error'
                      : undefined
                  }
                  onChange={(event) =>
                    onChange({ notificationEmail: event.target.value })
                  }
                />
                {showEmailError ? (
                  <FieldError id="settings-notification-email-error">
                    {errors.notificationEmail}
                  </FieldError>
                ) : null}
              </Field>
              <label className="flex min-h-control items-center gap-3 text-body">
                <input
                  type="checkbox"
                  className="size-5"
                  name="notifyEnabled"
                  checked={values.notifyEnabled}
                  onChange={(event) =>
                    onChange({ notifyEnabled: event.target.checked })
                  }
                />
                마감 임박 알림 받기
              </label>
            </>
          )}
        </FormSection>

        <AccountDeactivationSection hasAdminAccess={hasAdminAccess} />

        {submitError ? (
          <Alert variant="destructive">
            <AlertTitle>저장 결과를 확인해 주세요</AlertTitle>
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? '저장 중…' : '저장'}
          </Button>
        </div>
      </form>
    </PageBody>
  );
}
