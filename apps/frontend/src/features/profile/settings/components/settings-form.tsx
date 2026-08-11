import type { FormEvent } from 'react';
import { FormSection, PageBody, PageHeader } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { DEPARTMENT_GROUPS, OTHER_DEPARTMENT } from '../../departments';
import {
  isDepartmentRequiredForProfile,
  profileFieldRequirement,
  type ProfileRole,
} from '../../profile-requirements';
import {
  hasSavedStudentId,
  PROFILE_DEPARTMENT_MAX_LENGTH,
  PROFILE_NAME_MAX_LENGTH,
} from '../../profile-state';
import type {
  SettingsFormErrors,
  SettingsFormValues,
  SettingsNotificationLoadState,
} from '../types';
import { AccountDeactivationSection } from './account-deactivation-section';

interface SettingsFormProps {
  /** 세션 역할. 학번·학과 표시 여부와 필수 여부를 결정한다. */
  readonly role: ProfileRole | null;
  readonly values: SettingsFormValues;
  readonly errors: SettingsFormErrors;
  readonly showValidationErrors: boolean;
  readonly notificationLoad: SettingsNotificationLoadState;
  /** 알림 설정만 다시 불러오는 중인지. 버튼 중복 클릭을 막고 진행 상태를 알린다. */
  readonly isRetryingNotification: boolean;
  readonly isSubmitting: boolean;
  readonly submitError: string | null;
  readonly toastMessage: string | null;
  readonly onChange: (patch: Partial<SettingsFormValues>) => void;
  /** 알림 설정 조회 실패를 이 자리에서 복구한다 — 전체 새로고침을 요구하지 않는다. */
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
  role,
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

  const showNameError = showValidationErrors && errors.name !== null;
  const showStudentIdError = showValidationErrors && errors.studentId !== null;
  const showDepartmentError =
    showValidationErrors && errors.department !== null;
  const showEmailError =
    showValidationErrors && errors.notificationEmail !== null;
  // 저장 버튼은 제출 중일 때만 막는다. 무효 값에서도 클릭해 인라인 오류를 볼 수 있어야 한다(#156).

  // 학번은 학생만 가질 수 있다 — 교직원·관리자는 아예 입력받지 않는다(요청에
  // studentId가 실리면 백엔드가 400으로 거절한다). 다만 이 규칙이 생기기 전에
  // 이미 학번을 저장해 둔 계정은 그대로 읽기 전용으로 계속 보여 준다.
  const requirement = profileFieldRequirement(role);
  const isStudentIdLocked = hasSavedStudentId(values);
  const showStudentId = requirement.studentId || isStudentIdLocked;
  // 아직 학번이 없는 사용자가 학번을 적어 넣으면 학과도 함께 받아야 한다 — 학번이
  // 유일성 제약 아래 저장되는 행이 학과를 요구하기 때문이다. 이미 고정된 학번은 다시
  // 보내지 않으므로 그때는 역할 기준 그대로 둔다.
  const showDepartment =
    !isStudentIdLocked && isDepartmentRequiredForProfile(role, values.studentId)
      ? true
      : requirement.department;
  const editableFields = requirement.department
    ? '이름과 학과를 수정할 수 있습니다.'
    : '이름을 수정할 수 있습니다.';
  const profileSectionDescription = isStudentIdLocked
    ? `${editableFields} 학번은 변경할 수 없습니다.`
    : editableFields;

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

      {/* 구역 사이 64 — 프로필과 알림은 서로 다른 결정이다 */}
      <form className="flex flex-col gap-16" noValidate onSubmit={handleSubmit}>
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

          {showStudentId ? (
            <Field data-invalid={showStudentIdError || undefined}>
              <FieldLabel htmlFor="settings-student-id">학번</FieldLabel>
              <Input
                id="settings-student-id"
                name="studentId"
                inputMode="numeric"
                maxLength={6}
                value={values.studentId}
                readOnly={isStudentIdLocked}
                disabled={isStudentIdLocked}
                aria-readonly={isStudentIdLocked || undefined}
                aria-invalid={showStudentIdError}
                onChange={
                  isStudentIdLocked
                    ? undefined
                    : (event) =>
                        onChange({
                          studentId: event.target.value.replace(/\D/g, ''),
                        })
                }
              />
              {showStudentIdError ? (
                <FieldError>{errors.studentId}</FieldError>
              ) : (
                <FieldDescription>
                  {isStudentIdLocked
                    ? '학번은 변경할 수 없습니다.'
                    : '숫자 6자리로 입력합니다.'}
                </FieldDescription>
              )}
            </Field>
          ) : null}

          {showDepartment ? (
            <Field data-invalid={showDepartmentError || undefined}>
              <FieldLabel htmlFor="settings-department">학과</FieldLabel>
              <Select
                id="settings-department"
                name="department"
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
              </Select>
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
              {/* 실패한 조각만 제자리에서 되살린다 — 전체 새로고침을 시키면 사용자가
                  이미 고쳐 둔 프로필 입력이 함께 날아간다. 권한 문제로 보이는 경우에도
                  버튼을 감추지 않는다(docs/rules/frontend.md — affordance는 런타임
                  상태 추측으로 숨기지 않는다). 역할이 방금 바뀌었을 수 있다. */}
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

              {/* 체크박스 줄도 손이 닿는 크기(44)를 유지한다 */}
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

        <AccountDeactivationSection role={role} />

        {submitError ? (
          <Alert variant="destructive">
            <AlertTitle>설정을 저장하지 못했습니다</AlertTitle>
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        ) : null}

        {/* 이 화면의 주 행동은 저장 하나다 — 채운 버튼도 여기 하나뿐이다 */}
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? '저장 중…' : '저장'}
          </Button>
        </div>
      </form>
    </PageBody>
  );
}
