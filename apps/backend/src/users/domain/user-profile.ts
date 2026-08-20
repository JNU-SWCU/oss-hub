import {
  isCompleteUserProfile,
  type UserProfileRecord,
} from '../user-profile-policy';

export {
  effectiveProfileRole,
  isCompleteProfileFields,
  isCompleteUserProfile,
  isValidDepartment,
  isValidStudentId,
  isValidUserName,
  profileFieldRequirement,
  USER_DEPARTMENT_MAX_LENGTH,
  USER_NAME_MAX_LENGTH,
  type ProfileFieldRequirement,
  type UserProfileRecord,
} from '../user-profile-policy';

export interface UserProfile {
  readonly name: string;
  readonly studentId: string | null;
  readonly department: string | null;
  readonly isComplete: boolean;
}

/**
 * 1회 완료 저장에 실제로 기록할 값.
 *
 * 학번·학과가 필요 없는 역할(STAFF·ADMIN)은 null로 완료될 수 있어 non-null이
 * 아니다. 어떤 값이 필수인지는 역할 정책이 판정하고 서비스가 먼저 거른다.
 */
export interface CompleteUserProfileInput {
  readonly name: string;
  readonly studentId: string | null;
  readonly department: string | null;
}

/**
 * 본인 프로필 쓰기 본문 — 이름·학과는 항상 있다.
 *
 * 학번은 아직 저장된 값이 없을 때만 실을 수 있다 — 미완료 상태의 완료 저장이든,
 * 완료된 뒤 처음 채우는 경우든 마찬가지다. 이미 값이 있는데 다른 값을 보내면
 * USR_003, 같은 값을 다시 보내면 통과한다(폼이 현재 값을 그대로 싣는 정상 동작).
 */
export interface PatchUserProfileInput {
  readonly name: string;
  readonly studentId?: string;
  readonly department: string;
}

/**
 * 완료된 프로필에서 바꿀 수 있는 항목 — 이름·학과 둘 다 보낸다.
 *
 * 학번은 여기 없다. 비어 있던 학번을 처음 채우는 것은 UserProfile 행을 만드는 일이고
 * (그 행의 unique 제약이 학번 유일성을 보증하는 유일한 장치다) 이름·학과 갱신과는 다른
 * 경로를 탄다 — `UsersRepositoryPort.fillStudentId`.
 */
export interface UpdateProfileFieldsInput {
  readonly name: string;
  readonly department: string;
}

export function toUserProfile(record: UserProfileRecord): UserProfile {
  return {
    name: record.name ?? '',
    studentId: record.studentId,
    department: record.department,
    isComplete: isCompleteUserProfile(record),
  };
}
