import { DepartmentType, MemberKind } from './user-contract.config';
import { AccountStatus, type Prisma } from '@prisma/client';
export type CanonicalUserFixture = {
  readonly id: string;
  readonly githubId: bigint;
  readonly nickname: string;
  readonly memberKind?: MemberKind | null;
  readonly hasStaffAccess?: boolean;
  readonly hasAdminAccess?: boolean;
  readonly accountStatus?: AccountStatus;
  readonly name?: string;
  readonly studentId?: string | null;
  readonly department?: string;
};
const DEFAULT_STUDENT_DEPARTMENT = '합성 학과';
const DEFAULT_STAFF_DEPARTMENT = '합성 사업단';
export function canonicalUserCreate(
  fixture: CanonicalUserFixture,
): Prisma.UserCreateInput {
  const memberKind = fixture.memberKind ?? MemberKind.STUDENT;
  const base = {
    id: fixture.id,
    githubId: fixture.githubId,
    nickname: fixture.nickname,
    accountStatus: fixture.accountStatus ?? AccountStatus.ACTIVE,
    type: fixture.memberKind === null ? 'UNSELECTED' : memberKind,
    approvalStatus:
      fixture.memberKind === null || memberKind === 'STUDENT'
        ? 'NOT_REQUIRED'
        : fixture.hasStaffAccess
          ? 'APPROVED'
          : 'PENDING',
    ...(fixture.hasAdminAccess
      ? { admin: { create: { origin: 'BOOTSTRAP' as const } } }
      : {}),
  } satisfies Prisma.UserCreateInput;
  if (fixture.memberKind === null) {
    return base;
  }
  const isStudent = memberKind === MemberKind.STUDENT;
  const department =
    fixture.department ??
    (isStudent ? DEFAULT_STUDENT_DEPARTMENT : DEFAULT_STAFF_DEPARTMENT);
  return {
    ...base,
    profileCreatedAt: new Date(),
    profileUpdatedAt: new Date(),
    name: fixture.name ?? `합성 ${fixture.nickname}`,
    studentId: isStudent
      ? (fixture.studentId ?? syntheticStudentId(fixture.githubId))
      : null,
    department,
    departmentType: isStudent
      ? DepartmentType.DEPARTMENT
      : DepartmentType.PROGRAM_OFFICE,
  };
}
function syntheticStudentId(githubId: bigint): string {
  return String(githubId % 10000000000n).padStart(6, '0');
}
export function canonicalUserCreateFromLabel(
  label: 'STUDENT' | 'STAFF' | 'ADMIN' | null,
  fixture: Omit<
    CanonicalUserFixture,
    'memberKind' | 'hasStaffAccess' | 'hasAdminAccess'
  >,
): Prisma.UserCreateInput {
  const facts = authorityFactsFor(label);
  return canonicalUserCreate({
    ...fixture,
    memberKind: facts.selectedMemberKind,
    hasStaffAccess: facts.hasStaffAccess,
    hasAdminAccess: facts.hasAdminAccess,
  });
}
export function authorityFactsFor(
  label: 'STUDENT' | 'STAFF' | 'ADMIN' | null,
): {
  readonly selectedMemberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
} {
  switch (label) {
    case 'STUDENT':
      return {
        selectedMemberKind: MemberKind.STUDENT,
        hasStaffAccess: false,
        hasAdminAccess: false,
      };
    case 'STAFF':
      return {
        selectedMemberKind: MemberKind.STAFF,
        hasStaffAccess: true,
        hasAdminAccess: false,
      };
    case 'ADMIN':
      return {
        selectedMemberKind: null,
        hasStaffAccess: false,
        hasAdminAccess: true,
      };
    case null:
      return {
        selectedMemberKind: null,
        hasStaffAccess: false,
        hasAdminAccess: false,
      };
  }
}

export function flatProfileFixture(profile: {
  readonly name: string;
  readonly studentId: string | null;
  readonly department: string;
  readonly memberKind: MemberKind;
  readonly departmentType: DepartmentType;
  readonly staffNumber?: string | null;
}) {
  return {
    name: profile.name,
    studentId: profile.memberKind === 'STUDENT' ? profile.studentId : null,
    department: profile.department,
    type: profile.memberKind,
    departmentType: profile.departmentType,
    ...(profile.staffNumber === undefined
      ? {}
      : { staffNumber: profile.staffNumber }),
    profileCreatedAt: new Date(),
    profileUpdatedAt: new Date(),
  };
}
