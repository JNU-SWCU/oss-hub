import type { Role } from '@prisma/client';

/**
 * 역할별 프로필 필수 항목 — 백엔드 판정 규칙의 단일 출처다(#439).
 *
 * | 역할 | 이름 | 학번 | 학과 |
 * | --- | --- | --- | --- |
 * | 학생(STUDENT) | 필수 | 필수 | 필수 |
 * | 교직원(STAFF) | 필수 | — | 필수 |
 * | 관리자(ADMIN) | 필수 | — | — |
 *
 * 프런트의 `features/profile/profile-requirements.ts`와 같은 표를 구현한다.
 * 한쪽만 바꾸면 화면과 저장이 어긋나므로 두 파일을 함께 고친다.
 */
export interface UserProfileRecord {
  readonly id: string;
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
  /**
   * 역할 배정 전에는 null이고, 역할을 조회하지 않은 호출자는 아예 넘기지 않는다.
   * 두 경우 모두 `DEFAULT_PROFILE_ROLE`(학생) 기준으로 판정한다 — fail-closed.
   */
  readonly role?: Role | null;
}

export type UserProfileFields = Pick<
  UserProfileRecord,
  'name' | 'studentId' | 'department'
>;

export const USER_NAME_MAX_LENGTH = 100;
export const USER_DEPARTMENT_MAX_LENGTH = 100;
const STUDENT_ID_PATTERN = /^\d{6,10}$/;

/**
 * 역할이 없는 사용자에게 적용할 기준 역할.
 *
 * 온보딩 순서가 동의 → 프로필 → 역할 선택이라(RolesService.selectRole이
 * requireCompleteProfile을 먼저 부른다) 자력 온보딩 사용자는 프로필을 저장하는
 * 시점에 항상 role=null이다. 그리고 자력으로 고를 수 있는 역할은 STUDENT뿐이다
 * — STAFF·ADMIN은 관리자 승인·직접 변경·초기 역할 설정으로만 붙는다.
 * 여기서 완화하면 학번 없이 완료 처리된 뒤 STUDENT가 확정되고, 그 이후에 프로필을
 * 다시 검사하는 곳이 없어 학번 없는 학생이 영구히 남는다.
 */
export const DEFAULT_PROFILE_ROLE = 'STUDENT' satisfies Role;

export interface ProfileFieldRequirement {
  readonly studentId: boolean;
  readonly department: boolean;
}

const REQUIREMENT_BY_ROLE: Record<Role, ProfileFieldRequirement> = {
  STUDENT: { studentId: true, department: true },
  STAFF: { studentId: false, department: true },
  ADMIN: { studentId: false, department: false },
};

export function profileFieldRequirement(
  role: Role | null | undefined,
): ProfileFieldRequirement {
  return REQUIREMENT_BY_ROLE[role ?? DEFAULT_PROFILE_ROLE];
}

export function isValidUserName(name: string): boolean {
  return (
    name.trim().length > 0 && Array.from(name).length <= USER_NAME_MAX_LENGTH
  );
}

export function isValidStudentId(studentId: string): boolean {
  return STUDENT_ID_PATTERN.test(studentId);
}

export function isValidDepartment(department: string): boolean {
  return (
    department.trim().length > 0 &&
    Array.from(department).length <= USER_DEPARTMENT_MAX_LENGTH
  );
}

/**
 * 역할이 요구하는 항목이 모두 유효한가.
 *
 * 요구하지 않는 항목은 비어 있어도 완료다. 다만 값이 실려 있으면 형식은 지켜야
 * 한다 — 프런트 응답 파서(`isConsistentCompleteProfile`)가 `isComplete: true`인
 * 응답에 대해 "실려 온 값은 형식이 맞다"를 불변식으로 검사하기 때문에, 형식이
 * 깨진 값을 완료로 돌려주면 화면이 응답 자체를 거부한다.
 */
export function isCompleteProfileFields(
  fields: UserProfileFields,
  role: Role | null | undefined,
): boolean {
  const requirement = profileFieldRequirement(role);
  return (
    fields.name !== null &&
    isValidUserName(fields.name) &&
    isSatisfied(fields.studentId, requirement.studentId, isValidStudentId) &&
    isSatisfied(fields.department, requirement.department, isValidDepartment)
  );
}

export function isCompleteUserProfile(record: UserProfileRecord): boolean {
  return isCompleteProfileFields(record, record.role);
}

/**
 * 세 항목이 모두 있고 유효한가 — 학생 기준이자 가장 엄격한 판정.
 *
 * UserProfile 행을 만들 수 있는 조건과 같아서 backfill 스크립트가 이 함수를 쓴다
 * (`prisma/user-profile-backfill.ts`). 역할별 판정에는 쓰지 않는다.
 */
export function isValidCompleteUserProfileFields(fields: {
  readonly name: string;
  readonly studentId: string;
  readonly department: string;
}): boolean {
  return isCompleteProfileFields(fields, DEFAULT_PROFILE_ROLE);
}

function isSatisfied(
  value: string | null,
  required: boolean,
  isValid: (value: string) => boolean,
): boolean {
  if (value === null) {
    return !required;
  }
  return isValid(value);
}
