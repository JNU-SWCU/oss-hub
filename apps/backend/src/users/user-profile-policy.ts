import type { AffiliationKind, MemberKind, Role } from '@prisma/client';

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
  /**
   * 승인을 기다리는 교직원 요청이 있는가.
   *
   * 교직원은 관리자가 승인해야 `role`에 STAFF가 붙는다. 그 전까지 `role`은 null이라
   * 역할만 보면 학생 기준으로 판정되고, 순서를 역할 → 프로필로 바꾼 의미가 사라진다
   * — 승인을 기다리는 동안 프로필을 입력하는 사람이 바로 그 교직원이기 때문이다.
   * 조회하지 않은 호출자는 넘기지 않으며, 그때는 `role`만으로 판정한다.
   */
  readonly hasPendingStaffRequest?: boolean;
  /**
   * 가입 절차에서 고른 역할 — 아직 확정되지 않은 선택이다(#569).
   *
   * 확정을 `가입 마치기`로 미루면서 **프로필을 입력하는 동안에는 확정된 근거가 아무것도
   * 없는** 구간이 생겼다. 역할은 비어 있고 승인 요청도 아직 만들어지지 않는다. 그
   * 구간에서 무엇을 물어야 할지 아는 유일한 근거가 이 값이다 — 없으면 교직원이 다시
   * 학생 기준으로 학번을 요구받는다.
   */
  readonly selectedRole?: Role | null;
  readonly selectedMemberKind?: MemberKind | null;
  readonly memberKind?: MemberKind | null;
  readonly affiliationKind?: AffiliationKind | null;
  readonly affiliationName?: string | null;
  readonly hasStaffAccess?: boolean;
  readonly hasAdminAccess?: boolean;
}

export type UserProfileFields = Pick<
  UserProfileRecord,
  'name' | 'studentId' | 'department'
>;

export const USER_NAME_MAX_LENGTH = 100;
export const USER_DEPARTMENT_MAX_LENGTH = 100;
const STUDENT_ID_PATTERN = /^\d{6}$/;

/**
 * 역할을 아직 알 수 없는 사용자에게 적용할 기준 역할 — fail-closed.
 *
 * 온보딩 순서를 동의 → **역할** → 프로필로 바꾼 뒤, 프로필을 저장하는 시점에는
 * 사용자가 고른 역할을 안다(`effectiveProfileRole`의 세 근거).
 * 그래도 이 기본값을 없애지 않는 이유는, 역할을 조회하지 않은 호출자와 아직 아무것도
 * 고르지 않은 사용자가 여전히 있기 때문이다. 그 경우 가장 엄격한 학생 기준으로 본다
 * — 여기서 완화하면 학번 없이 완료 처리된 뒤 STUDENT가 확정되고, 그 이후에 프로필을
 * 다시 검사하는 곳이 없어 학번 없는 학생이 영구히 남는다.
 */
export const DEFAULT_PROFILE_ROLE = 'STUDENT' satisfies Role;

/**
 * 프로필 필수 항목을 판정할 때 쓰는 역할.
 *
 * 세 근거를 이 순서로 본다.
 *
 * 1. **배정된 역할** — 확정된 사실이라 언제나 답이다.
 * 2. **살아 있는 교직원 요청** — 승인을 기다리는 교직원은 아직 `role`이 비어 있지만
 *    이미 가입을 마친 사람이다. 학생 기준으로 되돌리면 그가 학번을 요구받고, 프로필
 *    화면에서 학번이 '필수'로 바뀌어 교직원 가입이 통째로 막힌다.
 * 3. **고른 역할** — 확정을 `가입 마치기`로 미룬 뒤 생긴 구간이다(#569). 프로필을
 *    입력하는 동안에는 1도 2도 없고, 무엇을 물어야 할지 아는 근거가 이것뿐이다.
 *
 * 세 근거가 모두 없으면 `null`이고, 호출부는 가장 엄격한 학생 기준으로 본다
 * (`DEFAULT_PROFILE_ROLE`).
 */
export function effectiveProfileRole(
  record: Pick<
    UserProfileRecord,
    'role' | 'hasPendingStaffRequest' | 'selectedRole'
  >,
): Role | null {
  if (record.role) {
    return record.role;
  }
  if (record.hasPendingStaffRequest) {
    return 'STAFF';
  }
  return record.selectedRole ?? null;
}

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

export function isValidUserName(name: string): boolean {
  return isValidProfileText(name, USER_NAME_MAX_LENGTH);
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
 * 저장된 값을 새 형식으로 재면 그때 가입한 학생의 프로필이 통째로 미완료로 뒤집힌다.
 * 그 판정은 세션의 `isProfileComplete`(`auth.repository.ts`)와 프로필 응답의
 * `isComplete`(`toUserProfile`)를 함께 뒤집어, 게이트가 그를 가입 마지막 단계로
 * 되돌린다 — 학번은 학적 식별자로 고정돼 바꿀 수 없으므로(`USR_003`) 그 화면에서
 * 빠져나갈 방법이 없다.
 *
 * 지금 형식(`isValidStudentId`)은 **새로 들어오는 값**에만 적용한다: DTO의
 * `@Matches`, 비어 있던 학번을 처음 채우는 검사, 요청에 실려 온 학번의 완료 저장
 * 검사가 그 자리다. 프런트도 같은 선을 긋는다(`profile-requirements.ts`).
 */
export function isStoredStudentId(studentId: string): boolean {
  return STORED_STUDENT_ID_PATTERN.test(studentId);
}

export function isValidDepartment(department: string): boolean {
  return isValidProfileText(department, USER_DEPARTMENT_MAX_LENGTH);
}

/**
 * 역할이 요구하는 항목이 모두 채워졌는가.
 *
 * 요구하지 않는 항목은 비어 있어도 완료다. 저장된 학번은 형식이 아니라 존재만
 * 본다(`isStoredStudentId`) — 형식이 좁아지기 전에 저장된 값 때문에 이미 가입을
 * 마친 사람이 미완료로 되돌아가지 않게 하기 위해서다. 프런트 응답 파서
 * (`isConsistentCompleteProfile`)도 같은 기준으로 불변식을 검사한다.
 */
export function isCompleteProfileFields(
  fields: UserProfileFields,
  role: Role | null | undefined,
): boolean {
  const requirement = profileFieldRequirement(role);
  return (
    fields.name !== null &&
    isValidUserName(fields.name) &&
    isSatisfied(fields.studentId, requirement.studentId, isStoredStudentId) &&
    isSatisfied(fields.department, requirement.department, isValidDepartment)
  );
}

export function isCompleteUserProfile(record: UserProfileRecord): boolean {
  return isCompleteProfileFields(record, effectiveProfileRole(record));
}

/**
 * 세 항목이 모두 있고 유효한가 — 학생 기준이자 가장 엄격한 판정.
 *
 * UserProfile 행을 만들 수 있는 조건과 같아서 backfill 스크립트가 이 함수를 쓴다
 * (`prisma/user-profile-backfill.ts`). 역할별 판정에는 쓰지 않는다.
 *
 * 학번 형식은 여기서만 계속 엄격하게 본다. 완료 판정은 이미 저장된 값을 형식으로
 * 재지 않지만(`isStoredStudentId`), 이 함수가 정하는 것은 "이 값으로 **새 행을
 * 만들어도 되는가**"다 — 예전 형식 값을 새 행으로 옮기는 것은 기존 데이터를
 * 손대는 결정이라 이 변경의 범위 밖이다.
 */
export function isValidCompleteUserProfileFields(fields: {
  readonly name: string;
  readonly studentId: string;
  readonly department: string;
}): boolean {
  return (
    isValidStudentId(fields.studentId) &&
    isCompleteProfileFields(fields, DEFAULT_PROFILE_ROLE)
  );
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
