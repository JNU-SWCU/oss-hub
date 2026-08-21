import { useRef, type FormEvent } from 'react';
import {
  signupPrimaryClassName,
  FormSection,
  SignupEyebrow,
  SignupLede,
  SignupTitle,
} from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { OTHER_DEPARTMENT } from '../departments';
import type { ProfileMemberKind } from '../profile-requirements';
import { isProfileFormValid, PROFILE_NAME_MAX_LENGTH } from '../profile-state';
import type { ProfileFormErrors, ProfileFormValues } from '../types';
import { ProfileAffiliationFields } from './profile-affiliation-fields';

const NAME_ERROR_ID = 'profile-name-error';
const STUDENT_ID_ERROR_ID = 'profile-student-id-error';
const STUDENT_ID_DESCRIPTION_ID = 'profile-student-id-description';

interface ProfileOnboardingFormProps {
  readonly mode?: 'onboarding' | 'reclassification';
  readonly memberKind: ProfileMemberKind;
  readonly values: ProfileFormValues;
  readonly errors: ProfileFormErrors;
  readonly showRequiredErrors: boolean;
  readonly isSubmitting: boolean;
  readonly submitError: string | null;
  readonly onChange: (patch: Partial<ProfileFormValues>) => void;
  readonly onSubmit: () => void;
}

export function ProfileOnboardingForm({
  mode = 'onboarding',
  memberKind,
  values,
  errors,
  showRequiredErrors,
  isSubmitting,
  submitError,
  onChange,
  onSubmit,
}: ProfileOnboardingFormProps) {
  const nameRef = useRef<HTMLInputElement>(null);
  const studentIdRef = useRef<HTMLInputElement>(null);
  const departmentRef = useRef<HTMLSelectElement>(null);
  const otherDepartmentRef = useRef<HTMLInputElement>(null);
  const affiliationNameRef = useRef<HTMLInputElement>(null);
  const showStudentId = memberKind === 'STUDENT';
  const showNameError = showRequiredErrors && errors.name !== null;
  const showStudentIdError =
    errors.studentId !== null &&
    (showRequiredErrors || values.studentId.length > 0);
  const showAffiliationError = showRequiredErrors && errors.department !== null;
  const isValid = isProfileFormValid(errors);

  function firstInvalidControl(): HTMLElement | null {
    if (errors.name !== null) return nameRef.current;
    if (errors.studentId !== null) return studentIdRef.current;
    if (values.affiliationKind === 'PROGRAM_OFFICE') {
      return affiliationNameRef.current;
    }
    return values.departmentOption === OTHER_DEPARTMENT
      ? otherDepartmentRef.current
      : departmentRef.current;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onSubmit();
    if (!isValid) firstInvalidControl()?.focus();
  }

  const profileFields = [
    '이름',
    ...(showStudentId ? ['학번'] : []),
    values.affiliationKind === 'DEPARTMENT' ? '학과' : '사업단',
  ];

  const reclassification = mode === 'reclassification';
  let submitLabel = '가입 마치기';
  if (isSubmitting) {
    submitLabel = '저장 중…';
  } else if (reclassification) {
    submitLabel = '회원 유형 확인 완료';
  }

  return (
    <>
      {reclassification ? null : (
        <>
          <SignupEyebrow>STEP 3 / 3 · 마지막</SignupEyebrow>
          <SignupTitle>
            기본 정보를 입력하면
            <br />
            가입이 끝납니다
          </SignupTitle>
        </>
      )}
      <SignupLede>
        {reclassification
          ? `필요한 항목(${profileFields.join(', ')})을 확인하면 관리자 권한은 그대로 유지됩니다.`
          : `프로그램 신청과 팀 구성에 쓰이는 정보입니다. 필요한 항목(${profileFields.join(', ')})을 확인합니다.`}
      </SignupLede>
      <form className="flex flex-col gap-10" onSubmit={handleSubmit}>
        <FormSection
          title="신원 정보"
          description="입력한 정보는 이후 프로그램 신청과 프로필에 사용됩니다."
        >
          <Field data-invalid={showNameError || undefined}>
            <FieldLabel htmlFor="profile-name">
              이름
              <RequiredMark />
            </FieldLabel>
            <Input
              id="profile-name"
              name="name"
              ref={nameRef}
              autoComplete="name"
              aria-required="true"
              maxLength={PROFILE_NAME_MAX_LENGTH}
              value={values.name}
              aria-invalid={showNameError}
              aria-describedby={showNameError ? NAME_ERROR_ID : undefined}
              onChange={(event) => onChange({ name: event.target.value })}
            />
            {showNameError ? (
              <FieldError id={NAME_ERROR_ID}>{errors.name}</FieldError>
            ) : null}
          </Field>

          {showStudentId ? (
            <Field data-invalid={showStudentIdError || undefined}>
              <FieldLabel htmlFor="profile-student-id">
                학번
                <RequiredMark />
              </FieldLabel>
              <Input
                id="profile-student-id"
                name="studentId"
                ref={studentIdRef}
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                value={values.studentId}
                aria-invalid={showStudentIdError}
                aria-describedby={
                  showStudentIdError
                    ? `${STUDENT_ID_DESCRIPTION_ID} ${STUDENT_ID_ERROR_ID}`
                    : STUDENT_ID_DESCRIPTION_ID
                }
                onChange={(event) =>
                  onChange({
                    studentId: event.target.value.replace(/\D/g, ''),
                  })
                }
              />
              <FieldDescription id={STUDENT_ID_DESCRIPTION_ID}>
                숫자 6자리 · 사용자가 입력한 식별 정보
              </FieldDescription>
              {showStudentIdError ? (
                <FieldError id={STUDENT_ID_ERROR_ID}>
                  {errors.studentId}
                </FieldError>
              ) : null}
            </Field>
          ) : null}

          <ProfileAffiliationFields
            memberKind={memberKind}
            values={values}
            showError={showAffiliationError}
            error={errors.department}
            departmentRef={departmentRef}
            otherDepartmentRef={otherDepartmentRef}
            affiliationNameRef={affiliationNameRef}
            onChange={onChange}
          />
        </FormSection>

        {submitError ? (
          <div data-surface={reclassification ? 'default' : undefined}>
            <Alert
              variant="destructive"
              className={
                reclassification
                  ? 'break-keep text-destructive-on-tint [overflow-wrap:anywhere] *:data-[slot=alert-description]:text-destructive-on-tint'
                  : undefined
              }
            >
              <AlertTitle>
                {reclassification
                  ? '회원 정보를 저장하지 못했습니다'
                  : '프로필을 저장하지 못했습니다'}
              </AlertTitle>
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          </div>
        ) : null}

        <Button
          className={signupPrimaryClassName}
          type="submit"
          size="lg"
          disabled={isSubmitting}
        >
          {submitLabel}
        </Button>
      </form>
    </>
  );
}

function RequiredMark() {
  return (
    <span className="ml-1 text-small font-semibold text-cosmos-repository">
      필수
    </span>
  );
}
