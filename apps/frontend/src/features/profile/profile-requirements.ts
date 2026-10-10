export type ProfileMemberKind = 'STUDENT' | 'STAFF';

export type ProfileRole = ProfileMemberKind | 'ADMIN';

export const PROFILE_NAME_MAX_LENGTH = 100;
export const PROFILE_DEPARTMENT_MAX_LENGTH = 100;
const STUDENT_ID_PATTERN = /^\d{6}$/;
const PHONE_PATTERN = /^\d{10,11}$/;

export interface ProfileFieldRequirement {
  readonly studentId: boolean;
  readonly phone: boolean;
  readonly department: boolean;
}

const REQUIREMENT_BY_MEMBER_KIND: Record<
  ProfileMemberKind,
  ProfileFieldRequirement
> = {
  STUDENT: { studentId: true, phone: true, department: true },
  STAFF: { studentId: false, phone: false, department: true },
};

export function profileFieldRequirement(
  memberKind: ProfileRole | null,
): ProfileFieldRequirement {
  return memberKind === 'ADMIN'
    ? { studentId: false, phone: false, department: false }
    : REQUIREMENT_BY_MEMBER_KIND[memberKind ?? 'STUDENT'];
}

export function isDepartmentRequiredForProfile(
  memberKind: ProfileRole | null,
  studentId: string,
): boolean {
  return (
    profileFieldRequirement(memberKind).department ||
    studentId.trim().length > 0
  );
}

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

export function normalizePhone(value: string): string {
  return value;
}

export function isValidPhone(phone: string): boolean {
  return PHONE_PATTERN.test(phone);
}

const STORED_STUDENT_ID_PATTERN = /^\d{6,10}$/;

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
  readonly phone: string | null;
}

export function isProfileComplete(
  fields: ProfileCompletionFields,
  memberKind: ProfileRole | null,
): boolean {
  const requirement = profileFieldRequirement(memberKind);
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
  if (
    requirement.phone &&
    (fields.phone === null || !isValidPhone(fields.phone))
  ) {
    return false;
  }
  return true;
}

export function isConsistentCompleteProfile(
  fields: ProfileCompletionFields,
): boolean {
  return (
    isValidProfileName(fields.name) &&
    (fields.studentId === null || isStoredStudentId(fields.studentId)) &&
    (fields.department === null || isValidDepartment(fields.department)) &&
    (fields.phone === null || isValidPhone(fields.phone))
  );
}
