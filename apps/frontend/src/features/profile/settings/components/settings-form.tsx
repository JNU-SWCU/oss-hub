import type { FormEvent } from 'react';
import { FormSection, PageHeader } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { DEPARTMENT_GROUPS, OTHER_DEPARTMENT } from '../../departments';
import {
  profileFieldRequirement,
  type ProfileRole,
} from '../../profile-requirements';
import {
  PROFILE_DEPARTMENT_MAX_LENGTH,
  PROFILE_NAME_MAX_LENGTH,
} from '../../profile-state';
import type {
  SettingsFormErrors,
  SettingsFormValues,
  SettingsNotificationLoadState,
} from '../types';

interface SettingsFormProps {
  /** 세션 역할. 학번·학과 표시 여부와 필수 여부를 결정한다. */
  readonly role: ProfileRole | null;
  readonly values: SettingsFormValues;
  readonly errors: SettingsFormErrors;
  readonly showValidationErrors: boolean;
  readonly notificationLoad: SettingsNotificationLoadState;
  readonly isSubmitting: boolean;
  readonly submitError: string | null;
  readonly toastMessage: string | null;
  readonly onChange: (patch: Partial<SettingsFormValues>) => void;
  readonly onSubmit: () => void;
}

export function SettingsSkeleton() {
  return (
    <main
      className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6"
      role="status"
      aria-label="설정을 불러오는 중"
    >
      <div className="h-16 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-80 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
    </main>
  );
}

export function SettingsForm({
  role,
  values,
  errors,
  showValidationErrors,
  notificationLoad,
  isSubmitting,
  submitError,
  toastMessage,
  onChange,
  onSubmit,
}: SettingsFormProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onSubmit();
  }

  const showNameError = showValidationErrors && errors.name !== null;
  const showDepartmentError =
    showValidationErrors && errors.department !== null;
  const showEmailError =
    showValidationErrors && errors.notificationEmail !== null;
  // 저장 버튼은 제출 중일 때만 막는다. 무효 값에서도 클릭해 인라인 오류를 볼 수 있어야 한다(#156).

  // 역할이 요구하지 않는 항목은 감춘다. 값은 폼 상태에 그대로 남아 저장 요청에
  // 다시 실리므로, 역할이 바뀌어도 이미 저장된 학번·학과가 지워지지 않는다.
  const requirement = profileFieldRequirement(role);
  const editableFields = requirement.department
    ? '이름과 학과를 수정할 수 있습니다.'
    : '이름을 수정할 수 있습니다.';
  const profileSectionDescription = requirement.studentId
    ? `${editableFields} 학번은 변경할 수 없습니다.`
    : editableFields;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <PageHeader
        title="설정"
        description="프로필과 알림 수신 설정을 관리합니다."
      />

      {toastMessage ? (
        <div
          role="status"
          className="rounded-lg border border-status-approved-bg bg-status-approved-bg px-3 py-2 text-sm text-status-approved-fg"
        >
          {toastMessage}
        </div>
      ) : null}

      <form className="flex flex-col gap-6" noValidate onSubmit={handleSubmit}>
        <FormSection title="프로필" description={profileSectionDescription}>
          <Field data-invalid={showNameError || undefined}>
            <FieldLabel htmlFor="settings-name">이름</FieldLabel>
            <Input
              id="settings-name"
              name="name"
              autoComplete="name"
              maxLength={PROFILE_NAME_MAX_LENGTH}
              value={values.name}
              aria-invalid={showNameError}
              onChange={(event) => onChange({ name: event.target.value })}
            />
            {showNameError ? <FieldError>{errors.name}</FieldError> : null}
          </Field>

          {requirement.studentId ? (
            <Field>
              <FieldLabel htmlFor="settings-student-id">학번</FieldLabel>
              <Input
                id="settings-student-id"
                name="studentId"
                value={values.studentId}
                readOnly
                disabled
                aria-readonly="true"
              />
              <FieldDescription>학번은 변경할 수 없습니다.</FieldDescription>
            </Field>
          ) : null}

          {requirement.department ? (
            <Field data-invalid={showDepartmentError || undefined}>
              <FieldLabel htmlFor="settings-department">학과</FieldLabel>
              <select
                id="settings-department"
                name="department"
                className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                value={values.departmentOption}
                aria-invalid={showDepartmentError}
                onChange={(event) =>
                  onChange({
                    departmentOption: event.target.value,
                    otherDepartment:
                      event.target.value === OTHER_DEPARTMENT
                        ? values.otherDepartment
                        : '',
                  })
                }
              >
                <option value="">학과를 선택해 주세요</option>
                {DEPARTMENT_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.departments.map((department) => (
                      <option key={department} value={department}>
                        {department}
                      </option>
                    ))}
                  </optgroup>
                ))}
                <option value={OTHER_DEPARTMENT}>기타(직접 입력)</option>
              </select>
              {values.departmentOption === OTHER_DEPARTMENT ? (
                <Input
                  aria-label="기타 학과"
                  placeholder="학과 또는 전공을 입력해 주세요"
                  maxLength={PROFILE_DEPARTMENT_MAX_LENGTH}
                  value={values.otherDepartment}
                  aria-invalid={showDepartmentError}
                  onChange={(event) =>
                    onChange({ otherDepartment: event.target.value })
                  }
                />
              ) : null}
              {showDepartmentError ? (
                <FieldError>{errors.department}</FieldError>
              ) : null}
            </Field>
          ) : null}
        </FormSection>

        <FormSection
          title="알림 수신"
          description="마감 임박 알림 메일을 받을 이메일과 수신 여부를 설정합니다."
        >
          {notificationLoad.kind === 'unavailable' ? (
            <Alert>
              <AlertTitle>알림 설정을 사용할 수 없습니다</AlertTitle>
              <AlertDescription>{notificationLoad.message}</AlertDescription>
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

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
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

        {submitError ? (
          <Alert variant="destructive">
            <AlertTitle>설정을 저장하지 못했습니다</AlertTitle>
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        ) : null}

        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? '저장 중…' : '저장'}
        </Button>
      </form>
    </main>
  );
}
