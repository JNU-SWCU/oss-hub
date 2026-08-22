import { AffiliationKind, MemberKind, Role } from '@prisma/client';
import {
  applyMemberAuthorityBackfill,
  MemberAuthorityBackfillInvariantError,
} from './member-authority-backfill-core';
import type { MemberAuthorityBackfillUser } from './member-authority-backfill-types';
import { legacySelectedMemberKind } from './member-authority-backfill-validation';

const cases = [
  {
    role: Role.STUDENT,
    selectedRole: Role.STAFF,
    expected: MemberKind.STUDENT,
    repairChanges: 1,
  },
  {
    role: Role.STAFF,
    selectedRole: Role.STUDENT,
    expected: MemberKind.STAFF,
    repairChanges: 1,
  },
  {
    role: Role.ADMIN,
    selectedRole: Role.STAFF,
    expected: null,
    repairChanges: 1,
  },
  { role: Role.ADMIN, selectedRole: null, expected: null, repairChanges: 0 },
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
    'accepts exact v1 $role/$selectedRole state and repairs only drift',
    ({ role, selectedRole, expected, repairChanges }) => {
      const repaired = applyMemberAuthorityBackfill([
        onceAppliedV1User(role, selectedRole),
      ]);

      expect(repaired).toMatchObject({
        changedUsers: repairChanges,
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
    {
      name: 'selection disagrees with retained selection',
      user: onceAppliedV1User(Role.STUDENT, Role.STUDENT, MemberKind.STAFF),
    },
    {
      name: 'exact stale selection has contradictory access',
      user: onceAppliedV1User(Role.STUDENT, Role.STAFF, MemberKind.STAFF, true),
    },
    {
      name: 'ADMIN has unrelated canonical member state',
      user: {
        ...onceAppliedV1User(Role.STUDENT, Role.STUDENT),
        id: 'synthetic-selection-admin-canonical-conflict',
        role: Role.ADMIN,
        hasStaffAccess: true,
        hasAdminAccess: true,
      },
    },
    {
      name: 'canonical-null row has contradictory non-null access',
      user: {
        ...pristineUser(Role.STUDENT, Role.STUDENT),
        hasStaffAccess: true,
      },
    },
    {
      name: 'STAFF v1 candidate retains a profile student ID',
      user: withProfileStudentId(onceAppliedV1User(Role.STAFF, Role.STAFF)),
    },
    {
      name: 'affiliation mirror differs from the profile department',
      user: withAffiliationMismatch(
        onceAppliedV1User(Role.STUDENT, Role.STUDENT),
      ),
    },
    {
      name: 'only selected member kind is canonicalized',
      user: {
        ...pristineUser(Role.STUDENT, Role.STUDENT),
        selectedMemberKind: MemberKind.STUDENT,
      },
    },
  ])('rejects hybrid state: $name', ({ user }) => {
    expectUnknownSelection(user);
  });
});

function withProfileStudentId(
  user: MemberAuthorityBackfillUser,
): MemberAuthorityBackfillUser {
  if (user.profile === null) throw new TypeError('Expected synthetic profile');
  return {
    ...user,
    studentId: '780099',
    profile: { ...user.profile, studentId: '780099' },
  };
}

function withAffiliationMismatch(
  user: MemberAuthorityBackfillUser,
): MemberAuthorityBackfillUser {
  if (user.profile === null) throw new TypeError('Expected synthetic profile');
  return {
    ...user,
    profile: { ...user.profile, affiliationName: '합성 불일치 소속' },
  };
}

function expectUnknownSelection(user: MemberAuthorityBackfillUser): void {
  try {
    applyMemberAuthorityBackfill([user]);
    throw new Error('Expected selection invariant failure');
  } catch (error: unknown) {
    if (!(error instanceof MemberAuthorityBackfillInvariantError)) throw error;
    expect([
      'UNKNOWN_SELECTION_COMBINATION',
      'UNAPPROVED_PROFILE_MISMATCH',
    ]).toContain(error.kind);
  }
}

function pristineUser(
  role: Role,
  selectedRole: Role | null,
): MemberAuthorityBackfillUser {
  return {
    id: `synthetic-selection-${role}-${selectedRole ?? 'none'}`,
    githubId: `synthetic-github-${role}-${selectedRole ?? 'none'}`,
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
  selectedRole: Role | null,
  selectedMemberKind = legacySelectedMemberKind(selectedRole),
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
