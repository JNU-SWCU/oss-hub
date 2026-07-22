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
import {
  classifyProfileApiError,
  completeMyProfile,
  getMyProfile,
} from '../api';
import { DEPARTMENT_GROUPS, OTHER_DEPARTMENT } from '../departments';
import {
  createInitialProfileForm,
  getProfileRedirect,
  isProfileFormValid,
  PROFILE_DEPARTMENT_MAX_LENGTH,
  PROFILE_NAME_MAX_LENGTH,
  PROFILE_ONBOARDING_NEXT_PATH,
  toCompleteProfileRequest,
  validateProfileForm,
} from '../profile-state';
import type { ProfileFormErrors, ProfileFormValues } from '../types';

interface ProfileFormProps {
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
    <main
      className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6"
      role="status"
      aria-label="프로필을 불러오는 중"
    >
      <div className="h-16 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-80 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
    </main>
  );
}

export function ProfileForm({
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

  const showNameError = showRequiredErrors && errors.name !== null;
  const showStudentIdError =
    errors.studentId !== null &&
    (showRequiredErrors || values.studentId.length > 0);
  const showDepartmentError = showRequiredErrors && errors.department !== null;
  const isValid = isProfileFormValid(errors);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <PageHeader
        title="기본 프로필을 입력해 주세요"
        description="프로그램 참여에 필요한 이름, 학번, 학과를 확인합니다."
      />
      <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
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
            <FieldLabel htmlFor="profile-student-id">학번</FieldLabel>
            <Input
              id="profile-student-id"
              name="studentId"
              inputMode="numeric"
              autoComplete="off"
              value={values.studentId}
              aria-invalid={showStudentIdError}
              onChange={(event) => onChange({ studentId: event.target.value })}
            />
            <FieldDescription>숫자 6~10자리</FieldDescription>
            {showStudentIdError ? (
              <FieldError>{errors.studentId}</FieldError>
            ) : null}
          </Field>

          <Field data-invalid={showDepartmentError || undefined}>
            <FieldLabel htmlFor="profile-department">학과</FieldLabel>
            <select
              id="profile-department"
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
        </FormSection>

        {submitError ? (
          <Alert variant="destructive">
            <AlertTitle>프로필을 저장하지 못했습니다</AlertTitle>
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        ) : null}

        <Button type="submit" size="lg" disabled={!isValid || isSubmitting}>
          {isSubmitting ? '저장 중…' : '저장하고 역할 선택으로 이동'}
        </Button>
      </form>
    </main>
  );
}

export function ProfileOnboardingScreen() {
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
          router.replace(PROFILE_ONBOARDING_NEXT_PATH);
          return true;
        case 'generic':
          return false;
      }
    },
    [router],
  );

  const loadProfile = useCallback(
    async (signal?: AbortSignal) => {
      setLoadError(null);
      try {
        const profile = await getMyProfile(signal);
        const redirect = getProfileRedirect(profile);
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
    [navigateForError, router],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadProfile(controller.signal);
    return () => controller.abort();
  }, [loadProfile]);

  const errors = useMemo(
    () =>
      values
        ? validateProfileForm(values)
        : { name: null, studentId: null, department: null },
    [values],
  );

  async function submit(): Promise<void> {
    if (!values || submissionInFlight.current) {
      return;
    }
    setHasSubmitted(true);
    const request = toCompleteProfileRequest(values);
    if (!request) {
      return;
    }

    submissionInFlight.current = true;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await completeMyProfile(request);
      router.replace(PROFILE_ONBOARDING_NEXT_PATH);
      router.refresh();
    } catch (error: unknown) {
      if (!navigateForError(error)) {
        setSubmitError('잠시 후 다시 시도해 주세요.');
      }
    } finally {
      submissionInFlight.current = false;
      setIsSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
        <Alert variant="destructive">
          <AlertTitle>프로필을 불러오지 못했습니다</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
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
      </main>
    );
  }

  if (!values) {
    return <ProfileSkeleton />;
  }

  return (
    <ProfileForm
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
