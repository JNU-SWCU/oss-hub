export interface UserProfileRecord {
  readonly id: string;
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
}

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
    isComplete:
      record.name !== null &&
      record.name.trim().length > 0 &&
      record.studentId !== null &&
      record.department !== null,
  };
}
