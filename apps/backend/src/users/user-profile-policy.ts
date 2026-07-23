export interface UserProfileRecord {
  readonly id: string;
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
}

export const USER_NAME_MAX_LENGTH = 100;
export const USER_DEPARTMENT_MAX_LENGTH = 100;
const STUDENT_ID_PATTERN = /^\d{6,10}$/;

export function isCompleteUserProfile(record: UserProfileRecord): boolean {
  const name = record.name;
  const studentId = record.studentId;
  const department = record.department;
  return (
    name !== null &&
    name.trim().length > 0 &&
    name.length <= USER_NAME_MAX_LENGTH &&
    studentId !== null &&
    STUDENT_ID_PATTERN.test(studentId) &&
    department !== null &&
    department.trim().length > 0 &&
    department.length <= USER_DEPARTMENT_MAX_LENGTH
  );
}
