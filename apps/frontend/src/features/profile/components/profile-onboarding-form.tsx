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
import type { ProfileMemberKind } from '../profile-requirements';
import { isProfileFormValid, PROFILE_NAME_MAX_LENGTH } from '../profile-state';
import type { ProfileFormErrors, ProfileFormValues } from '../types';
import { ProfileAffiliationFields } from './profile-affiliation-fields';

const NAME_ERROR_ID = 'profile-name-error';
const STUDENT_ID_ERROR_ID = 'profile-student-id-error';
const STUDENT_ID_DESCRIPTION_ID = 'profile-student-id-description';
const PHONE_ERROR_ID = 'profile-phone-error';
const PHONE_DESCRIPTION_ID = 'profile-phone-description';

interface ProfileOnboardingFormProps {
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
  const phoneRef = useRef<HTMLInputElement>(null);
  const departmentRef = useRef<HTMLSelectElement>(null);
  const affiliationNameRef = useRef<HTMLInputElement>(null);
  // 학번과 전화번호는 학생에게만 묻는다. 두 이름으로 나누면 한쪽만 바뀌어 항목과 안내가 갈라진다.
  const isStudent = memberKind === 'STUDENT';
  const showNameError = showRequiredErrors && errors.name !== null;
  const showStudentIdError =
    errors.studentId !== null &&
    (showRequiredErrors || values.studentId.length > 0);
  const showPhoneError =
    isStudent &&
    errors.phone !== null &&
    (showRequiredErrors || values.phone.length > 0);
  const showAffiliationError = showRequiredErrors && errors.department !== null;
  const isValid = isProfileFormValid(errors);

  function firstInvalidControl(): HTMLElement | null {
    if (errors.name !== null) return nameRef.current;
    if (errors.studentId !== null) return studentIdRef.current;
    if (isStudent && errors.phone !== null) return phoneRef.current;
    if (values.affiliationKind === 'PROGRAM_OFFICE') {
      return affiliationNameRef.current;
    }
    return departmentRef.current;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onSubmit();
    if (!isValid) firstInvalidControl()?.focus();
  }

  return (
    <>
      <SignupEyebrow>STEP 3 / 3 · 마지막</SignupEyebrow>
      <SignupTitle>
        기본 정보를 입력하면
        <br />
        가입이 끝납니다
      </SignupTitle>
      {/*
        무엇을 써야 하는지는 아래 항목의 라벨과 필수 표시가 이미 말한다. 문장으로 다시
        열거하면 같은 사실을 두 번 읽히고, 항목이 바뀔 때 문장만 남아 어긋난다.
      */}
      <SignupLede>프로그램 신청과 팀 구성에 쓰이는 정보입니다.</SignupLede>
      <form className="flex flex-col gap-10" onSubmit={handleSubmit}>
        <FormSection title="신원 정보">
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

          {isStudent ? (
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

          {isStudent ? (
            <Field data-invalid={showPhoneError || undefined}>
              <FieldLabel htmlFor="profile-phone">
                전화번호
                <RequiredMark />
              </FieldLabel>
              <Input
                id="profile-phone"
                name="phone"
                ref={phoneRef}
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                maxLength={11}
                value={values.phone}
                aria-required="true"
                aria-invalid={showPhoneError}
                aria-describedby={
                  showPhoneError
                    ? `${PHONE_DESCRIPTION_ID} ${PHONE_ERROR_ID}`
                    : PHONE_DESCRIPTION_ID
                }
                onChange={(event) => onChange({ phone: event.target.value })}
              />
              <FieldDescription id={PHONE_DESCRIPTION_ID}>
                프로그램 운영진이 선정·팀 운영 안내를 연락할 때 사용합니다.
              </FieldDescription>
              {showPhoneError ? (
                <FieldError id={PHONE_ERROR_ID}>{errors.phone}</FieldError>
              ) : null}
            </Field>
          ) : null}

          <ProfileAffiliationFields
            memberKind={memberKind}
            values={values}
            showError={showAffiliationError}
            error={errors.department}
            departmentRef={departmentRef}
            affiliationNameRef={affiliationNameRef}
            onChange={onChange}
          />
        </FormSection>

        {submitError ? (
          <Alert variant="destructive">
            <AlertTitle>프로필을 저장하지 못했습니다</AlertTitle>
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        ) : null}

        <Button
          className={signupPrimaryClassName}
          type="submit"
          size="lg"
          disabled={isSubmitting}
        >
          {isSubmitting ? '저장 중…' : '가입 마치기'}
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
