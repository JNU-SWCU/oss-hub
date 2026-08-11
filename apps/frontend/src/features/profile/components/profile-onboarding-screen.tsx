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
import {
  signupPrimaryClassName,
  FormSection,
  PageBody,
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
import { Select } from '@/components/ui/select';
import { rememberSignupCompletion } from '@/lib/signup-completion-notice';
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

/**
 * 오류 문구의 id — 입력칸이 `aria-describedby`로 이 문구를 가리킨다.
 *
 * 시각적으로는 칸 바로 아래에 붙어 있어 연결이 자명하지만, 스크린 리더에서는
 * 가리키지 않으면 읽히지 않는다. 초점이 칸에 있는 채로 "무엇이 잘못됐는지"가
 * 함께 읽혀야 제출 실패 뒤 초점 이동이 실제 안내가 된다.
 */
const NAME_ERROR_ID = 'profile-name-error';
const STUDENT_ID_ERROR_ID = 'profile-student-id-error';
const STUDENT_ID_DESCRIPTION_ID = 'profile-student-id-description';
const DEPARTMENT_ERROR_ID = 'profile-department-error';

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
  const nameRef = useRef<HTMLInputElement>(null);
  const studentIdRef = useRef<HTMLInputElement>(null);
  const departmentRef = useRef<HTMLSelectElement>(null);
  const otherDepartmentRef = useRef<HTMLInputElement>(null);

  /**
   * 아직 채워지지 않은 첫 칸.
   *
   * `errors`를 그대로 보고 고른다 — 표시 여부(`showRequiredErrors`)는 이 제출로
   * 비로소 켜지는 값이라, 제출 순간에는 아직 꺼져 있다.
   */
  function firstInvalidControl(): HTMLElement | null {
    if (errors.name !== null) {
      return nameRef.current;
    }
    if (errors.studentId !== null) {
      return studentIdRef.current;
    }
    if (errors.department !== null) {
      return values.departmentOption === OTHER_DEPARTMENT
        ? otherDepartmentRef.current
        : departmentRef.current;
    }
    return null;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onSubmit();
    // 저장으로 이어지지 않는 제출이라면 화면이 그 사실을 말해야 한다. 안내 문구는
    // `onSubmit`이 켜는 `showRequiredErrors`가 띄우고, 여기서는 그 문구가 붙은 칸으로
    // 초점을 옮겨 키보드·스크린 리더 사용자가 곧바로 고쳐 쓸 수 있게 한다. 입력 노드는
    // 다시 그려도 그대로라 상태 반영 전에 초점을 옮겨도 안전하다.
    if (!isValid) {
      firstInvalidControl()?.focus();
    }
  }

  // 학번은 학생만 가질 수 있다 — 교직원·관리자는 학번이 없는 신분이라 이 화면에서
  // 아예 입력받지 않는다(요청에 studentId가 실리면 백엔드가 400으로 거절한다,
  // users.service.ts). 학과와 마찬가지로 역할이 요구하지 않으면 칸 자체를 감춘다.
  const requirement = profileFieldRequirement(role);
  const showStudentId = requirement.studentId;
  // 학번을 적어 넣는 순간 학과도 필요해진다 — 학번이 유일성 제약 아래 저장되는 자리가
  // 학과를 요구하는 행이기 때문이다(`isDepartmentRequiredForProfile`). 그래서 학과 칸은
  // 역할이 요구할 때뿐 아니라 사용자가 학번을 적었을 때도 함께 연다.
  const showDepartment = isDepartmentRequiredForProfile(role, values.studentId);
  const profileFields = [
    '이름',
    ...(requirement.studentId ? ['학번'] : []),
    ...(requirement.department ? ['학과'] : []),
  ];

  const showNameError = showRequiredErrors && errors.name !== null;
  const showStudentIdError =
    errors.studentId !== null &&
    (showRequiredErrors || values.studentId.length > 0);
  const showDepartmentError = showRequiredErrors && errors.department !== null;
  const isValid = isProfileFormValid(errors);

  return (
    <>
      <SignupEyebrow>STEP 3 / 3 · 마지막</SignupEyebrow>
      {/* 회원가입의 정의가 여기서 완성된다 — GitHub 연결만으로는 가입이 아니고
          이 화면을 마쳐야 회원이다. 제목과 버튼이 그 사실을 그대로 말한다.
          "입력해 주세요"는 아직 몇 개가 더 남았는지 알려 주지 않았다. */}
      <SignupTitle>
        기본 정보를 입력하면
        <br />
        가입이 끝납니다
      </SignupTitle>
      {/* 항목을 괄호로 묶어 나열한다 — "학번 선택"처럼 항목 이름 자체가 두 낱말인
          경우가 있어, 문장에 그대로 이어 붙이면 어디까지가 한 항목인지 흐려진다. */}
      <SignupLede>
        {`프로그램 신청과 팀 구성에 쓰이는 정보입니다. 필요한 항목(${profileFields.join(', ')})을 확인합니다.`}
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
                숫자 6자리
              </FieldDescription>
              {showStudentIdError ? (
                <FieldError id={STUDENT_ID_ERROR_ID}>
                  {errors.studentId}
                </FieldError>
              ) : null}
            </Field>
          ) : null}

          {showDepartment ? (
            <Field data-invalid={showDepartmentError || undefined}>
              <FieldLabel htmlFor="profile-department">
                학과
                <RequiredMark />
              </FieldLabel>
              <Select
                id="profile-department"
                name="department"
                ref={departmentRef}
                aria-required="true"
                // 네이티브 select 규격(`components/ui/select`)에는 입력칸과 달리
                // 오류 테두리가 없다. 빈 학과를 알리는 자리가 이 칸이라 여기서만 덧댄다.
                //
                // 목록 색도 여기서만 덧댄다(QA34). 이 화면은 가입 무대
                // (`_shell/signup-stage.tsx`의 `data-surface="inverted"`) 안이라
                // `color`가 `--hero-foreground`(#ffffff)로 상속된다. 규격의
                // `bg-transparent`와 합쳐지면 option·optgroup이 **흰 글자 + 투명
                // 배경**이 되는데(측정: `color` rgb(255,255,255), `background-color`
                // rgba(0,0,0,0)), 열린 목록은 페이지가 아니라 브라우저가 그리고 그
                // 바탕은 시스템 `Canvas`다 — 이 문서에서 #ffffff로 측정된다. 흰 글자가
                // 흰 바탕에 얹혀 1.00:1이 되고, 마우스가 얹힌 한 줄만 강조색 덕에 읽힌다.
                // 그래서 팝오버 한 쌍(#ffffff / #444444, 9.74:1)을 목록에 직접 입혀
                // 브라우저가 무엇을 깔든 읽히게 한다. 닫힌 칸의 글자색은 그대로
                // 흰색이라 어두운 무대 위 대비는 건드리지 않는다.
                //
                // ⚠ `globals.css`의 반전 스코프에 토큰을 더하는 길로는 풀지 않는다 —
                // 같은 무대의 주 버튼(`signupPrimaryClassName`)이 흰 배경 + `--primary`
                // 글자라 그 토큰을 밝게 바꾸면 그쪽이 무너진다(#708이 실측한 사실).
                // 규격(`components/ui/select`)이 아니라 이 호출부인 이유는, 나머지 세
                // 곳(설정·교직원 대시보드·신청자 목록)은 흰 업무 화면이라 같은 결함이
                // 없기 때문이다.
                className="aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_optgroup]:bg-popover [&_optgroup]:text-popover-foreground [&_option]:bg-popover [&_option]:text-popover-foreground"
                value={values.departmentOption}
                aria-invalid={showDepartmentError}
                aria-describedby={
                  showDepartmentError ? DEPARTMENT_ERROR_ID : undefined
                }
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
                  ref={otherDepartmentRef}
                  placeholder="학과 또는 전공을 입력해 주세요"
                  maxLength={PROFILE_DEPARTMENT_MAX_LENGTH}
                  value={values.otherDepartment}
                  aria-invalid={showDepartmentError}
                  aria-describedby={
                    showDepartmentError ? DEPARTMENT_ERROR_ID : undefined
                  }
                  onChange={(event) =>
                    onChange({ otherDepartment: event.target.value })
                  }
                />
              ) : null}
              {showDepartmentError ? (
                <FieldError id={DEPARTMENT_ERROR_ID}>
                  {errors.department}
                </FieldError>
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

        {/* 저장할 수 없는 상태에서도 누를 수 있게 둔다 — 버튼을 꺼 두면 화면이 무엇이
            비었는지 말할 기회를 영영 얻지 못한다. 회색 버튼 하나가 유일한 단서였고,
            그것은 남은 항목이 무엇인지 알려 주지 않는다. 누르면 안내 문구가 뜨고
            첫 빈 칸으로 초점이 간다(`handleSubmit`). 저장 요청은 검증을 통과할 때만
            나간다(`toCompleteProfileRequest`)므로 잘못된 값이 서버로 가지는 않는다. */}
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

/**
 * 필수 항목 표시.
 *
 * 예전에는 이 화면에 필수 표시가 하나도 없었다 — 무엇을 꼭 채워야 하는지 알
 * 방법이 "버튼이 안 켜진다"뿐이었다. 별표(*) 대신 글자로 적는 이유는 별표가
 * 스크린 리더에서 읽히지 않거나 "애스터리스크"로 읽혀 뜻이 전달되지 않아서다.
 * 입력칸에는 `aria-required`를 따로 붙인다.
 */
function RequiredMark() {
  return (
    <span className="ml-1 text-small font-semibold text-cosmos-repository">
      필수
    </span>
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
      // 가입이 끝난 순간은 여기다 — GitHub 연결이 아니라 프로필 저장이 회원가입을
      // 완성한다. 그 사실을 아는 곳은 이 한 줄뿐이라 안내 표시도 여기서 남긴다.
      // 다음 화면이 표시를 읽는 즉시 지운다(`lib/signup-completion-notice.ts`).
      rememberSignupCompletion(nextPath);
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
