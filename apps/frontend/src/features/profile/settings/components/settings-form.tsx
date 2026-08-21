import type { FormEvent } from 'react';
import { FormSection, PageBody, PageHeader } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { ProfileMemberKind } from '../../profile-requirements';
import type {
  SettingsFormErrors,
  SettingsFormValues,
  SettingsNotificationLoadState,
} from '../types';
import { AccountDeactivationSection } from './account-deactivation-section';
import { SettingsProfileSection } from './settings-profile-section';

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
    <PageBody
      className="max-w-2xl"
      role="status"
      aria-label="설정을 불러오는 중"
    >
      <div className="h-16 animate-pulse rounded-card bg-muted motion-reduce:animate-none" />
      <div className="h-80 animate-pulse rounded-card bg-muted motion-reduce:animate-none" />
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
  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onSubmit();
  }

  const showEmailError =
    showValidationErrors && errors.notificationEmail !== null;

  return (
    <PageBody className="max-w-2xl">
      <PageHeader
        title="설정"
        description="프로필과 알림 수신 설정을 관리합니다."
      />

      {toastMessage ? (
        <div
          role="status"
          className="rounded-card border border-status-approved-bg bg-status-approved-bg px-6 py-4 text-small font-semibold text-status-approved-fg"
        >
          {toastMessage}
        </div>
      ) : null}

      <form className="flex flex-col gap-16" noValidate onSubmit={handleSubmit}>
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
                  onChange={(event) =>
                    onChange({ notificationEmail: event.target.value })
                  }
                />
                {showEmailError ? (
                  <FieldError>{errors.notificationEmail}</FieldError>
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
            <AlertTitle>설정을 저장하지 못했습니다</AlertTitle>
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
