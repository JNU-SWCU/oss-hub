import {
  isCompleteUserProfile,
  type UserProfileRecord,
} from '../user-profile-policy';

export {
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
 * PATCH 본문 — 이름만 필수다.
 *
 * 학번은 미완료 상태의 완료 저장에서만 실을 수 있고, 완료 후 전달하면 USR_003.
 * 학과는 관리자처럼 학과가 필요 없는 역할이 생략할 수 있어 optional이다.
 * 생략된 항목은 기존 값을 그대로 둔다(PATCH 부분 갱신).
 */
export interface PatchUserProfileInput {
  readonly name: string;
  readonly studentId?: string;
  readonly department?: string;
}

export interface UpdateProfileFieldsInput {
  readonly name: string;
  readonly department?: string;
}

export function toUserProfile(record: UserProfileRecord): UserProfile {
  return {
    name: record.name ?? '',
    studentId: record.studentId,
    department: record.department,
    isComplete: isCompleteUserProfile(record),
  };
}
