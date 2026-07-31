/**
 * 역할별 프로필 필수 항목 — 이 파일이 판정 규칙의 단일 출처다.
 *
 * | 역할 | 이름 | 학번 | 학과 |
 * | --- | --- | --- | --- |
 * | 학생(STUDENT) | 필수 | 필수 | 필수 |
 * | 교직원(STAFF) | 필수 | — | 필수 |
 * | 관리자(ADMIN) | 필수 | — | — |
 *
 * 전부 순수 함수로 두고 역할을 인자로 받는다. 응답 파서·폼 검증·요청 빌더·화면이
 * 같은 규칙을 공유해야 하고, 역할은 세션에서 오기 때문에 모듈 안에서 조회하면
 * 테스트가 세션에 묶인다.
 *
 * `UserRole`을 `features/roles`에서 가져오지 않는 이유는 feature 간 직접 의존이
 * 금지돼 있기 때문이다(eslint feature 경계 규칙). 같은 값 집합을 여기서 다시
 * 선언하고, 세션을 아는 app 계층이 이 타입으로 역할을 넘긴다.
 */
export type ProfileRole = 'STUDENT' | 'STAFF' | 'ADMIN';

export const PROFILE_NAME_MAX_LENGTH = 100;
export const PROFILE_DEPARTMENT_MAX_LENGTH = 100;
export const STUDENT_ID_PATTERN = /^\d{6,10}$/;

export interface ProfileFieldRequirement {
  readonly studentId: boolean;
  readonly department: boolean;
}

const REQUIREMENT_BY_ROLE: Record<ProfileRole, ProfileFieldRequirement> = {
  STUDENT: { studentId: true, department: true },
  STAFF: { studentId: false, department: true },
  ADMIN: { studentId: false, department: false },
};

/**
 * 역할이 아직 없는 사용자는 학생 기준으로 본다.
 *
 * 온보딩 순서가 동의 → 프로필 입력 → 역할 선택이라 프로필을 입력하는 시점에는
 * 역할이 비어 있다. 여기서 완화하면 이름만 넣고 통과한 뒤 역할 선택에서 막힌다 —
 * 백엔드가 역할 배정 전에 학번을 포함한 완료 프로필을 요구한다(`USR_002`).
 */
export function profileFieldRequirement(
  role: ProfileRole | null,
): ProfileFieldRequirement {
  return REQUIREMENT_BY_ROLE[role ?? 'STUDENT'];
}

export function isValidProfileName(name: string): boolean {
  return name.trim().length > 0 && name.length <= PROFILE_NAME_MAX_LENGTH;
}

export function isValidStudentId(studentId: string): boolean {
  return STUDENT_ID_PATTERN.test(studentId);
}

export function isValidDepartment(department: string): boolean {
  return (
    department.trim().length > 0 &&
    department.length <= PROFILE_DEPARTMENT_MAX_LENGTH
  );
}

export interface ProfileCompletionFields {
  readonly name: string;
  readonly studentId: string | null;
  readonly department: string | null;
}

/** 역할이 요구하는 항목이 모두 채워졌는지 — 요구하지 않는 항목은 비어 있어도 완성이다. */
export function isProfileComplete(
  fields: ProfileCompletionFields,
  role: ProfileRole | null,
): boolean {
  const requirement = profileFieldRequirement(role);
  if (!isValidProfileName(fields.name)) {
    return false;
  }
  if (
    requirement.studentId &&
    (fields.studentId === null || !isValidStudentId(fields.studentId))
  ) {
    return false;
  }
  if (
    requirement.department &&
    (fields.department === null || !isValidDepartment(fields.department))
  ) {
    return false;
  }
  return true;
}

/**
 * 서버가 `isComplete: true`로 준 응답이 최소한 만족해야 하는 불변식.
 *
 * 필수 항목이 역할마다 다른데 프로필 응답에는 역할이 없다. 그래서 응답만 보고
 * 완료 여부를 다시 계산할 수는 없다 — 대신 어느 역할에서도 참이어야 하는 것만
 * 본다: 이름은 유효해야 하고, 실려 온 값은 형식이 맞아야 한다. 값이 `null`인
 * 항목은 그 역할에 필요 없는 항목일 수 있으므로 모순으로 보지 않는다.
 */
export function isConsistentCompleteProfile(
  fields: ProfileCompletionFields,
): boolean {
  return (
    isValidProfileName(fields.name) &&
    (fields.studentId === null || isValidStudentId(fields.studentId)) &&
    (fields.department === null || isValidDepartment(fields.department))
  );
}
