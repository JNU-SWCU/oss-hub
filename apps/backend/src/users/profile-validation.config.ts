import { MemberKind, type AffiliationKind } from '@prisma/client';
import { ValidateBy } from 'class-validator';

export interface UserProfileRecord {
  readonly id: string;
  readonly githubId?: bigint;
  readonly githubLogin?: string;
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
  readonly phone?: string | null;

  readonly staffNumber?: string | null;

  readonly hasPendingStaffRequest?: boolean;

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

export const DEFAULT_PROFILE_MEMBER_KIND = 'STUDENT' satisfies MemberKind;

export interface ProfileFieldRequirement {
  readonly studentId: boolean;
  readonly department: boolean;
}

const REQUIREMENT_BY_MEMBER_KIND: Record<MemberKind, ProfileFieldRequirement> =
  {
    STUDENT: { studentId: true, department: true },
    STAFF: { studentId: false, department: true },
  };

export function profileFieldRequirement(
  memberKind: MemberKind | null | undefined,
): ProfileFieldRequirement {
  return REQUIREMENT_BY_MEMBER_KIND[memberKind ?? DEFAULT_PROFILE_MEMBER_KIND];
}

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

const STORED_STUDENT_ID_PATTERN = /^\d{6,10}$/;

export function isStoredStudentId(studentId: string): boolean {
  return STORED_STUDENT_ID_PATTERN.test(studentId);
}

export function isValidDepartment(department: string): boolean {
  return isValidProfileText(department, USER_DEPARTMENT_MAX_LENGTH);
}

export function isCompleteProfileFields(
  fields: UserProfileFields,
  memberKind: MemberKind | null | undefined,
): boolean {
  const requirement = profileFieldRequirement(memberKind);
  return (
    fields.name !== null &&
    isValidUserName(fields.name) &&
    isSatisfied(fields.studentId, requirement.studentId, isStoredStudentId) &&
    isSatisfied(fields.department, requirement.department, isValidDepartment)
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

export function transformProfileText({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? normalizeProfileText(value) : value;
}

export function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export function IsProfileText(
  name: string,
  isValid: (value: string) => boolean,
): PropertyDecorator {
  return ValidateBy({
    name,
    validator: {
      validate(value: unknown): boolean {
        return typeof value === 'string' && isValid(value);
      },
    },
  });
}

export const MEMBER_KINDS = {
  STUDENT: 'STUDENT',
  STAFF: 'STAFF',
} as const satisfies Record<MemberKind, MemberKind>;

export function normalizeStaffNumber(value: string): string {
  return value.trim().normalize('NFC');
}

export function isValidStaffNumber(value: string): boolean {
  const normalized = normalizeStaffNumber(value);
  const codePointCount = Array.from(normalized).length;
  return codePointCount >= 1 && codePointCount <= 100;
}
