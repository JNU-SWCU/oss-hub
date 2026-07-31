export interface UserProfileRecord {
  readonly id: string;
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
}

export type CompleteUserProfileFields = {
  readonly name: string;
  readonly studentId: string;
  readonly department: string;
};

export const USER_NAME_MAX_LENGTH = 100;
export const USER_DEPARTMENT_MAX_LENGTH = 100;
const STUDENT_ID_PATTERN = /^\d{6,10}$/;

export function isValidCompleteUserProfileFields(
  fields: CompleteUserProfileFields,
): boolean {
  return (
    fields.name.trim().length > 0 &&
    Array.from(fields.name).length <= USER_NAME_MAX_LENGTH &&
    STUDENT_ID_PATTERN.test(fields.studentId) &&
    fields.department.trim().length > 0 &&
    Array.from(fields.department).length <= USER_DEPARTMENT_MAX_LENGTH
  );
}

export function isCompleteUserProfile(record: UserProfileRecord): boolean {
  const name = record.name;
  const studentId = record.studentId;
  const department = record.department;
  return name !== null && studentId !== null && department !== null
    ? isValidCompleteUserProfileFields({ name, studentId, department })
    : false;
}
