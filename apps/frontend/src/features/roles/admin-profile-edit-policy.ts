import { ApiError } from '@/lib/api-client';
import { DEPARTMENT_OPTIONS, OTHER_DEPARTMENT } from '@/lib/departments';

import type {
  AdminAccessProfile,
  AdminProfileUpdateCommand,
} from './admin-access-api';

/**
 * 관리자 프로필 수정 폼(admin-access-profile-section.tsx)의 검증·값 변환 규칙.
 *
 * `features/profile/profile-requirements.ts`·`profile-state.ts`와 형식 규칙 자체는
 * 같지만(이름 100자, 학과 100자, 학번 숫자 6~10자리 —
 * `apps/backend/src/users/dto/patch-admin-user-profile.dto.ts`가 본인 경로 DTO와
 * 같은 상수를 쓴다), feature 간 직접 의존이 금지돼 있어(eslint 경계 규칙,
 * docs/rules/frontend.md) 그 파일들을 가져다 쓸 수 없다. 관리자 경로만의 차이는
 * 하나뿐이다 — 학번이 이미 저장돼 있어도 잠기지 않는다(관리자가 오탈자·전산
 * 오류를 고칠 수 있어야 하므로, `admin-profile-mutation.service.ts`가 본인 경로의
 * STUDENT_ID_IMMUTABLE을 적용하지 않는다). 규칙이 바뀌면 두 파일을 함께 고쳐야 한다.
 */
export const ADMIN_PROFILE_NAME_MAX_LENGTH = 100;
export const ADMIN_PROFILE_DEPARTMENT_MAX_LENGTH = 100;
export const ADMIN_PROFILE_STUDENT_ID_PATTERN = /^\d{6,10}$/;

export function isValidAdminProfileName(name: string): boolean {
  return name.trim().length > 0 && name.length <= ADMIN_PROFILE_NAME_MAX_LENGTH;
}

export function isValidAdminProfileStudentId(studentId: string): boolean {
  return ADMIN_PROFILE_STUDENT_ID_PATTERN.test(studentId);
}

export function isValidAdminProfileDepartment(department: string): boolean {
  return (
    department.trim().length > 0 &&
    department.length <= ADMIN_PROFILE_DEPARTMENT_MAX_LENGTH
  );
}

export interface AdminProfileEditValues {
  readonly name: string;
  readonly studentId: string;
  readonly departmentOption: string;
  readonly otherDepartment: string;
}

/** `profile-state.ts`의 `createInitialProfileForm`과 같은 방식 — 목록에 없는 값은 "기타"로 편다. */
export function createAdminProfileEditValues(
  profile: AdminAccessProfile,
): AdminProfileEditValues {
  const department = profile.department ?? '';
  const isListed = DEPARTMENT_OPTIONS.includes(department);
  return {
    name: profile.name ?? '',
    studentId: profile.studentId ?? '',
    departmentOption: isListed
      ? department
      : department
        ? OTHER_DEPARTMENT
        : '',
    otherDepartment: isListed ? '' : department,
  };
}

export function resolveAdminProfileDepartment(
  values: Pick<AdminProfileEditValues, 'departmentOption' | 'otherDepartment'>,
): string {
  return values.departmentOption === OTHER_DEPARTMENT
    ? values.otherDepartment.trim()
    : values.departmentOption;
}

export interface AdminProfileEditErrors {
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
}

function nameError(name: string): string | null {
  if (name.trim().length === 0) {
    return '이름을 입력해 주세요.';
  }
  return isValidAdminProfileName(name)
    ? null
    : `이름은 ${ADMIN_PROFILE_NAME_MAX_LENGTH}자 이하로 입력해 주세요.`;
}

// 백엔드 PATCH 본문은 `string?`뿐이라(null로 지울 수 없다) 이미 저장된 값을 빈
// 칸으로 만들어 제출하면 형식 검증(@IsNotEmpty)에서 그대로 400이 난다. 그 혼란스러운
// 실패 대신 화면에서 먼저 "비워둘 수 없다"고 알린다 — 아직 값이 없던 항목을
// 비워 두는 것과는 구분해야 하므로 저장돼 있던 값이 있었는지(`hadValue`)를 받는다.
function studentIdError(studentId: string, hadValue: boolean): string | null {
  if (studentId.length === 0) {
    return hadValue ? '이미 저장된 학번은 비워둘 수 없습니다.' : null;
  }
  return isValidAdminProfileStudentId(studentId)
    ? null
    : '학번은 숫자 6~10자리로 입력해 주세요.';
}

function departmentError(
  department: string,
  hadValue: boolean,
  studentId: string,
): string | null {
  if (department.length === 0) {
    if (hadValue) {
      return '이미 저장된 학과는 비워둘 수 없습니다.';
    }
    // 학번의 유일성은 UserProfile 행 하나에만 걸리고 그 행은 학과를 필수로 요구한다
    // (USR_005) — 학번을 채우는 순간 학과도 함께 받아야 한다.
    return studentId.length > 0
      ? '학번을 저장하려면 학과도 함께 입력해 주세요.'
      : null;
  }
  return isValidAdminProfileDepartment(department)
    ? null
    : `학과는 ${ADMIN_PROFILE_DEPARTMENT_MAX_LENGTH}자 이하로 입력해 주세요.`;
}

export function validateAdminProfileEdit(
  values: AdminProfileEditValues,
  original: AdminAccessProfile,
): AdminProfileEditErrors {
  const studentId = values.studentId.trim();
  const department = resolveAdminProfileDepartment(values);
  return {
    name: nameError(values.name),
    studentId: studentIdError(studentId, (original.studentId ?? '').length > 0),
    department: departmentError(
      department,
      (original.department ?? '').length > 0,
      studentId,
    ),
  };
}

export function isAdminProfileEditValid(
  errors: AdminProfileEditErrors,
): boolean {
  return Object.values(errors).every((error) => error === null);
}

/**
 * 실제로 바뀐 항목만 담는다 — 검증을 통과하지 못하면 `null`. 바뀐 게 없으면 빈
 * 객체를 돌려주고(호출부가 API를 부르지 않고 바로 보기 모드로 돌아갈 수 있게),
 * 그 경우에도 백엔드 PATCH가 실제로 받으면 감사 로그 없이 조용히 통과한다
 * (`mutateAdminUserProfile`의 "바뀐 게 없으면 감사 로그를 쓰지 않는다" 테스트).
 */
export function toAdminProfileUpdateCommand(
  values: AdminProfileEditValues,
  original: AdminAccessProfile,
): AdminProfileUpdateCommand | null {
  const errors = validateAdminProfileEdit(values, original);
  if (!isAdminProfileEditValid(errors)) {
    return null;
  }
  const name = values.name.trim();
  const studentId = values.studentId.trim();
  const department = resolveAdminProfileDepartment(values);
  const command: {
    name?: string;
    studentId?: string;
    department?: string;
  } = {};
  if (name !== (original.name ?? '')) {
    command.name = name;
  }
  if (studentId !== (original.studentId ?? '')) {
    command.studentId = studentId;
  }
  if (department !== (original.department ?? '')) {
    command.department = department;
  }
  return command;
}

/**
 * `adminAccessMutationErrorMessage`(admin-access-mutation-policy.ts)와 같은 방식 —
 * 백엔드 `ProblemDetail.detail`이 이미 구분되는 한국어 안내다: 학번 중복은
 * `USR_008`("이미 다른 사용자가 사용 중인 학번이라 수정할 수 없습니다."), 학과 누락은
 * `USR_005`("학번을 저장하려면 학과도 함께 입력해 주세요.") 등. `ApiError`가 아닌
 * 실패(네트워크 오류 등)에만 일반 문구로 대신한다.
 */
export function adminProfileUpdateErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.problem.detail;
  return '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}
