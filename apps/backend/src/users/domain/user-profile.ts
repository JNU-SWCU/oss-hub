import {
  isCompleteUserProfile,
  type UserProfileRecord,
} from '../user-profile-policy';

export {
  isCompleteUserProfile,
  USER_DEPARTMENT_MAX_LENGTH,
  USER_NAME_MAX_LENGTH,
  type UserProfileRecord,
} from '../user-profile-policy';

export interface UserProfile {
  readonly name: string;
  readonly studentId: string | null;
  readonly department: string | null;
  readonly isComplete: boolean;
}

export interface CompleteUserProfileInput {
  readonly name: string;
  readonly studentId: string;
  readonly department: string;
}

/** PATCH 본문 — studentId는 미완료 완료 시에만 필수, 완료 후 전달 시 USR_003. */
export interface PatchUserProfileInput {
  readonly name: string;
  readonly studentId?: string;
  readonly department: string;
}

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
