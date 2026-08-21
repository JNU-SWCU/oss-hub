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
export const STUDENT_ID_PATTERN = /^\d{6}$/;

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

/**
 * 학번을 함께 저장하려면 학과도 필요하다 — 역할이 학과를 요구하지 않아도 그렇다.
 *
 * 학번의 유일성을 지키는 장치는 백엔드 `UserProfile` 행의 unique 제약 하나뿐이고,
 * 그 행은 학과를 반드시 요구한다. 학과 없이 학번만 보내면 백엔드가 400으로 거절하므로
 * (`USR_005`), 화면에서 학번을 받는 순간 학과 칸도 함께 열어 둔다. 관리자처럼 학과가
 * 필수가 아닌 역할에서만 실제로 달라지는 규칙이다.
 */
export function isDepartmentRequiredForProfile(
  role: ProfileRole | null,
  studentId: string,
): boolean {
  return (
    profileFieldRequirement(role).department || studentId.trim().length > 0
  );
}

/**
 * 쓰기 경계 문자열: 바깥 공백을 자른 뒤 NFC. NFKC는 쓰지 않는다.
 * 코드 포인트 수는 `Array.from(value).length`로 센다.
 */
export function normalizeProfileText(value: string): string {
  return value.trim().normalize('NFC');
}

function isValidProfileText(value: string, maxCodePoints: number): boolean {
  const count = Array.from(normalizeProfileText(value)).length;
  return count >= 1 && count <= maxCodePoints;
}

export function isValidProfileName(name: string): boolean {
  return isValidProfileText(name, PROFILE_NAME_MAX_LENGTH);
}

export function isValidStudentId(studentId: string): boolean {
  return STUDENT_ID_PATTERN.test(studentId);
}

/**
 * 이미 저장돼 있을 수 있는 학번의 형식 — 지금 규칙과 그 이전 규칙을 함께 받는다.
 *
 * 형식이 6~10자리에서 정확히 6자리로 좁혀졌지만(#835) 기존 값은 그대로 남았다.
 * `STUDENT_ID_PATTERN`은 이 집합의 부분집합이라, 오늘 통과하는 값은 언제나 여기도
 * 통과한다. 형식을 또 좁힐 일이 생기면 **이 패턴은 좁히지 않는다** — 여기가 좁아지는
 * 순간 그 형식으로 가입한 사람들이 미완료로 되돌아간다.
 */
const STORED_STUDENT_ID_PATTERN = /^\d{6,10}$/;

/**
 * 이미 저장된 학번은 지금 형식으로 다시 재지 않는다.
 *
 * 저장된 값을 새 형식으로 재면 그때 가입한 학생의 프로필이 통째로 미완료로 뒤집히고,
 * 게이트가 그를 온보딩으로 되돌린다 — 학번은 학적 식별자로 고정돼 바꿀 수 없으므로
 * (`USR_003`) 그 화면에서 빠져나갈 방법이 없다.
 *
 * 지금 형식(`isValidStudentId`)은 **새로 들어오는 값**에만 적용한다. 설정 화면이 이미
 * 같은 선을 긋고 있고(`validateSettingsProfileForm`), 백엔드도 같은 판정을 한다
 * (`user-profile-policy.ts`의 같은 이름 함수).
 */
export function isStoredStudentId(studentId: string): boolean {
  return STORED_STUDENT_ID_PATTERN.test(studentId);
}

export function isValidDepartment(department: string): boolean {
  return isValidProfileText(department, PROFILE_DEPARTMENT_MAX_LENGTH);
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
    (fields.studentId === null || !isStoredStudentId(fields.studentId))
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
 * 본다: 이름은 유효해야 하고, 실려 온 값은 비어 있지 않아야 한다. 값이 `null`인
 * 항목은 그 역할에 필요 없는 항목일 수 있으므로 모순으로 보지 않는다.
 *
 * 학번을 형식으로 재지 않는 이유는 완료 판정과 같다(`isStoredStudentId`). 여기서
 * 형식을 요구하면 예전 형식 학번을 가진 사용자의 프로필 응답을 **응답 자체가
 * 잘못됐다**며 통째로 거부해, 화면이 조회 실패로 접힌다.
 */
export function isConsistentCompleteProfile(
  fields: ProfileCompletionFields,
): boolean {
  return (
    isValidProfileName(fields.name) &&
    (fields.studentId === null || isStoredStudentId(fields.studentId)) &&
    (fields.department === null || isValidDepartment(fields.department))
  );
}
