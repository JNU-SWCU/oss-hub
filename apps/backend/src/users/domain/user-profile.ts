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

export function toUserProfile(record: UserProfileRecord): UserProfile {
  return {
    name: record.name ?? '',
    studentId: record.studentId,
    department: record.department,
    isComplete: isCompleteUserProfile(record),
  };
}
