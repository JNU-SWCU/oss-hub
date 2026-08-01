'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { useRouter } from 'next/navigation';
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
import {
  classifyProfileApiError,
  completeMyProfile,
  getMyProfile,
} from '../api';
import { DEPARTMENT_GROUPS, OTHER_DEPARTMENT } from '../departments';
import {
  isDepartmentRequiredForProfile,
  profileFieldRequirement,
  type ProfileRole,
} from '../profile-requirements';
import {
  createInitialProfileForm,
  getProfileRedirect,
  isProfileFormValid,
  PROFILE_DEPARTMENT_MAX_LENGTH,
  PROFILE_NAME_MAX_LENGTH,
  toCompleteProfileRequest,
  validateProfileForm,
} from '../profile-state';
import type { ProfileFormErrors, ProfileFormValues } from '../types';

interface ProfileFormProps {
  /** 세션 역할. 아직 배정 전이면 `null`이고, 그때는 학생 기준을 따른다. */
  readonly role: ProfileRole | null;
  readonly values: ProfileFormValues;
  readonly errors: ProfileFormErrors;
  readonly showRequiredErrors: boolean;
  readonly isSubmitting: boolean;
  readonly submitError: string | null;
  readonly onChange: (patch: Partial<ProfileFormValues>) => void;
  readonly onSubmit: () => void;
}

export function ProfileSkeleton() {
  return (
    <PageBody
      className="max-w-2xl"
      role="status"
      aria-label="프로필을 불러오는 중"
    >
      <div className="h-16 animate-pulse rounded-card bg-muted motion-reduce:animate-none" />
      <div className="h-80 animate-pulse rounded-card bg-muted motion-reduce:animate-none" />
    </PageBody>
  );
}

export function ProfileForm({
  role,
  values,
  errors,
  showRequiredErrors,
  isSubmitting,
  submitError,
  onChange,
  onSubmit,
}: ProfileFormProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onSubmit();
  }

  // 학과는 역할이 요구하지 않으면 감추지만, 학번은 감추지 않고 "선택"으로 열어 둔다 —
  // 조교처럼 대학원생 신분을 겸하는 교직원은 학번이 실제로 있고 그 값을 남기고 싶어
  // 한다. 비워 두면 요청에서 키가 빠지고, 넣으면 학적 식별자로 고정된다.
  // 머리말은 필수 항목을 먼저 늘어놓고, 선택으로 열린 학번을 맨 뒤에 덧붙인다.
  const requirement = profileFieldRequirement(role);
  // 학번을 적어 넣는 순간 학과도 필요해진다 — 학번이 유일성 제약 아래 저장되는 자리가
  // 학과를 요구하는 행이기 때문이다(`isDepartmentRequiredForProfile`). 그래서 학과 칸은
  // 역할이 요구할 때뿐 아니라 사용자가 학번을 적었을 때도 함께 연다.
  const showDepartment = isDepartmentRequiredForProfile(role, values.studentId);
  const profileFields = [
    '이름',
    ...(requirement.studentId ? ['학번'] : []),
    ...(requirement.department ? ['학과'] : []),
    ...(requirement.studentId ? [] : ['학번 선택']),
  ];

  const showNameError = showRequiredErrors && errors.name !== null;
  const showStudentIdError =
    errors.studentId !== null &&
    (showRequiredErrors || values.studentId.length > 0);
  const showDepartmentError = showRequiredErrors && errors.department !== null;
  const isValid = isProfileFormValid(errors);

  return (
    <PageBody className="max-w-2xl">
      <PageHeader
        title="기본 프로필을 입력해 주세요"
        description={`프로그램 참여에 필요한 항목(${profileFields.join(', ')})을 확인합니다.`}
      />
      <form className="flex flex-col gap-16" onSubmit={handleSubmit}>
        <FormSection
          title="신원 정보"
          description="입력한 정보는 이후 프로그램 신청과 프로필에 사용됩니다."
        >
          <Field data-invalid={showNameError || undefined}>
            <FieldLabel htmlFor="profile-name">이름</FieldLabel>
            <Input
              id="profile-name"
              name="name"
              autoComplete="name"
              maxLength={PROFILE_NAME_MAX_LENGTH}
              value={values.name}
              aria-invalid={showNameError}
              onChange={(event) => onChange({ name: event.target.value })}
            />
            {showNameError ? <FieldError>{errors.name}</FieldError> : null}
          </Field>

          <Field data-invalid={showStudentIdError || undefined}>
            <FieldLabel htmlFor="profile-student-id">
              학번
              {requirement.studentId ? null : (
                <span className="ml-1 text-small font-normal text-muted-foreground">
                  선택
                </span>
              )}
            </FieldLabel>
            <Input
              id="profile-student-id"
              name="studentId"
              inputMode="numeric"
              autoComplete="off"
              value={values.studentId}
              aria-invalid={showStudentIdError}
              onChange={(event) => onChange({ studentId: event.target.value })}
            />
            <FieldDescription>
              {requirement.studentId
                ? '숫자 6~10자리'
                : '학번이 있으면 입력합니다. 숫자 6~10자리, 한 번 저장하면 변경할 수 없습니다.'}
            </FieldDescription>
            {showStudentIdError ? (
              <FieldError>{errors.studentId}</FieldError>
            ) : null}
          </Field>

          {showDepartment ? (
            <Field data-invalid={showDepartmentError || undefined}>
              <FieldLabel htmlFor="profile-department">학과</FieldLabel>
              <Select
                id="profile-department"
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

        {submitError ? (
          <Alert variant="destructive">
            <AlertTitle>프로필을 저장하지 못했습니다</AlertTitle>
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        ) : null}

        <Button type="submit" disabled={!isValid || isSubmitting}>
          {isSubmitting ? '저장 중…' : '저장하고 가입 마치기'}
        </Button>
      </form>
    </PageBody>
  );
}

export function ProfileOnboardingScreen({
  role,
  nextPath,
}: {
  /** app 계층이 세션에서 읽어 넘긴다 — feature는 auth·roles에 직접 의존할 수 없다. */
  readonly role: ProfileRole | null;
  /**
   * 저장을 마친 뒤 갈 곳. 프로필이 온보딩의 마지막 단계라 목적지가 역할마다 다르고,
   * 그 판단은 세션·역할 요청을 아는 app 계층이 한다.
   */
  readonly nextPath: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState<ProfileFormValues | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const submissionInFlight = useRef(false);

  const navigateForError = useCallback(
    (error: unknown): boolean => {
      switch (classifyProfileApiError(error)) {
        case 'unauthorized':
          window.location.assign('/');
          return true;
        case 'consent-required':
          router.replace('/consent');
          return true;
        case 'already-complete':
          router.replace(nextPath);
          return true;
        case 'student-id-taken':
        case 'generic':
          return false;
      }
    },
    [nextPath, router],
  );

  const loadProfile = useCallback(
    async (signal?: AbortSignal) => {
      setLoadError(null);
      try {
        const profile = await getMyProfile(signal);
        const redirect = getProfileRedirect(profile, role, nextPath);
        if (redirect) {
          router.replace(redirect);
          return;
        }
        setValues(createInitialProfileForm(profile));
      } catch (error: unknown) {
        if (signal?.aborted || navigateForError(error)) {
          return;
        }
        setLoadError('프로필 정보를 불러오지 못했습니다. 다시 시도해 주세요.');
      }
    },
    [navigateForError, nextPath, role, router],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadProfile(controller.signal);
    return () => controller.abort();
  }, [loadProfile]);

  const errors = useMemo(
    () =>
      values
        ? validateProfileForm(values, role)
        : { name: null, studentId: null, department: null },
    [role, values],
  );

  async function submit(): Promise<void> {
    if (!values || submissionInFlight.current) {
      return;
    }
    setHasSubmitted(true);
    const request = toCompleteProfileRequest(values, role);
    if (!request) {
      return;
    }

    submissionInFlight.current = true;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await completeMyProfile(request);
      // 여기만 전체 이동을 쓴다. 저장으로 세션의 `isProfileComplete`가 바뀌는데,
      // 공유 세션 저장소(`features/auth/session-store.ts`)는 페이지를 새로 읽을 때만
      // 채워진다. 클라이언트 라우팅으로 나가면 다음 화면의 `RoleGate`가 옛 값(미완료)을
      // 보고 이 화면으로 되돌리고, 이 화면은 프로필이 완료된 것을 보고 다시 내보내
      // 가입 마지막 단계에서 무한 왕복이 된다. 역할 선택이 전체 이동을 쓰는 이유와 같다
      // (`features/roles`의 `navigateAfterRoleSelection`).
      window.location.assign(nextPath);
    } catch (error: unknown) {
      if (!navigateForError(error)) {
        // 학번 중복은 재시도로 풀리지 않는다 — "잠시 후 다시"로 접으면 같은 벽을 반복한다.
        setSubmitError(
          classifyProfileApiError(error) === 'student-id-taken'
            ? '이미 다른 계정이 사용 중인 학번입니다. 학번을 다시 확인해 주세요.'
            : '잠시 후 다시 시도해 주세요.',
        );
      }
    } finally {
      submissionInFlight.current = false;
      setIsSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <PageBody className="max-w-2xl">
        <Alert variant="destructive">
          <AlertTitle>프로필을 불러오지 못했습니다</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-4">
            <span>{loadError}</span>
            <Button
              type="button"
              variant="outline"
              onClick={() => void loadProfile()}
            >
              다시 시도
            </Button>
          </AlertDescription>
        </Alert>
      </PageBody>
    );
  }

  if (!values) {
    return <ProfileSkeleton />;
  }

  return (
    <ProfileForm
      role={role}
      values={values}
      errors={errors}
      showRequiredErrors={hasSubmitted}
      isSubmitting={isSubmitting}
      submitError={submitError}
      onChange={(patch) =>
        setValues((current) => current && { ...current, ...patch })
      }
      onSubmit={() => void submit()}
    />
  );
}
