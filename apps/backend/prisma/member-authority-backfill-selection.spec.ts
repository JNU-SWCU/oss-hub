import { AffiliationKind, MemberKind, Role } from '@prisma/client';
import {
  applyMemberAuthorityBackfill,
  MemberAuthorityBackfillInvariantError,
} from './member-authority-backfill-core';
import type { MemberAuthorityBackfillUser } from './member-authority-backfill-types';

const cases = [
  {
    role: Role.STUDENT,
    selectedRole: Role.STAFF,
    expected: MemberKind.STUDENT,
  },
  {
    role: Role.STAFF,
    selectedRole: Role.STUDENT,
    expected: MemberKind.STAFF,
  },
  { role: Role.ADMIN, selectedRole: Role.STAFF, expected: null },
] as const;

describe('assigned-role selection precedence', () => {
  it.each(cases)(
    'projects $role over retained $selectedRole selection',
    ({ role, selectedRole, expected }) => {
      const first = applyMemberAuthorityBackfill([
        pristineUser(role, selectedRole),
      ]);
      const second = applyMemberAuthorityBackfill(first.users);

      expect(first.users[0]?.selectedMemberKind).toBe(expected);
      expect(second).toMatchObject({ changedUsers: 0, changedProfiles: 0 });
    },
  );

  it.each(cases)(
    'repairs only the exact v1 $role/$selectedRole conflict signature',
    ({ role, selectedRole, expected }) => {
      const repaired = applyMemberAuthorityBackfill([
        onceAppliedV1User(role, selectedRole),
      ]);

      expect(repaired).toMatchObject({
        changedUsers: 1,
        changedProfiles: 0,
        users: [{ selectedMemberKind: expected }],
      });
      expect(applyMemberAuthorityBackfill(repaired.users)).toMatchObject({
        changedUsers: 0,
        changedProfiles: 0,
      });
    },
  );

  it.each([
    onceAppliedV1User(Role.STUDENT, Role.STUDENT, MemberKind.STAFF),
    onceAppliedV1User(Role.STUDENT, Role.STAFF, MemberKind.STAFF, true),
    {
      ...onceAppliedV1User(Role.STUDENT, Role.STUDENT),
      id: 'synthetic-selection-admin-canonical-conflict',
      role: Role.ADMIN,
      hasStaffAccess: true,
      hasAdminAccess: true,
    },
  ])('rejects unrelated canonical or selection conflicts', (user) => {
    expectUnknownSelection(user);
  });
});

function expectUnknownSelection(user: MemberAuthorityBackfillUser): void {
  try {
    applyMemberAuthorityBackfill([user]);
    throw new Error('Expected selection invariant failure');
  } catch (error: unknown) {
    if (!(error instanceof MemberAuthorityBackfillInvariantError)) throw error;
    expect(error.kind).toBe('UNKNOWN_SELECTION_COMBINATION');
  }
}

function pristineUser(
  role: Role,
  selectedRole: Role,
): MemberAuthorityBackfillUser {
  return {
    id: `synthetic-selection-${role}-${selectedRole}`,
    githubId: `synthetic-github-${role}-${selectedRole}`,
    nickname: `synthetic-selection-${role.toLowerCase()}`,
    role,
    selectedRole,
    selectedMemberKind: null,
    hasStaffAccess: null,
    hasAdminAccess: null,
    name: '합성 권한 사용자',
    studentId: '780001',
    department: '합성 운영학과',
    profile: null,
  };
}

function onceAppliedV1User(
  role: Role,
  selectedRole: Role,
  selectedMemberKind = selectedRole === Role.STUDENT
    ? MemberKind.STUDENT
    : MemberKind.STAFF,
  mismatchedAccess = false,
): MemberAuthorityBackfillUser {
  const memberKind = memberKindForRole(role);
  const hasStaffAccess = role !== Role.STUDENT;
  const hasAdminAccess = role === Role.ADMIN;
  const profile = {
    name: '합성 권한 사용자',
    studentId: memberKind === MemberKind.STUDENT ? '780001' : null,
    department: '합성 운영학과',
    memberKind,
    affiliationKind: memberKind === null ? null : AffiliationKind.DEPARTMENT,
    affiliationName: memberKind === null ? null : '합성 운영학과',
  };
  return {
    ...pristineUser(role, selectedRole),
    selectedMemberKind,
    hasStaffAccess: mismatchedAccess ? !hasStaffAccess : hasStaffAccess,
    hasAdminAccess,
    studentId: profile.studentId,
    profile,
  };
}

function memberKindForRole(role: Role): MemberKind | null {
  switch (role) {
    case Role.STUDENT:
      return MemberKind.STUDENT;
    case Role.STAFF:
      return MemberKind.STAFF;
    case Role.ADMIN:
      return null;
  }
}
