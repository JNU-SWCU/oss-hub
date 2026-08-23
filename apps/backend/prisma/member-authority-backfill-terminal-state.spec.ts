import { AffiliationKind, MemberKind, Role } from '@prisma/client';
import {
  applyMemberAuthorityBackfill,
  MemberAuthorityBackfillInvariantError,
} from './member-authority-backfill-core';
import type {
  MemberAuthorityBackfillProfile,
  MemberAuthorityBackfillUser,
} from './member-authority-backfill-types';

type TerminalUser = MemberAuthorityBackfillUser & {
  readonly profile: MemberAuthorityBackfillProfile;
};

const exactCases = [
  terminalUser(MemberKind.STUDENT, AffiliationKind.DEPARTMENT, 1),
  terminalUser(MemberKind.STAFF, AffiliationKind.DEPARTMENT, 2),
  terminalUser(MemberKind.STAFF, AffiliationKind.PROGRAM_OFFICE, 3),
] as const;

describe('legacy-admin terminal backfill states', () => {
  it.each(exactCases)(
    'keeps exact $selectedMemberKind/$profile.affiliationKind state byte-equivalent',
    (user) => {
      // Given
      const before = JSON.stringify(user);

      // When
      const result = applyMemberAuthorityBackfill([user]);

      // Then
      expect(result).toMatchObject({ changedUsers: 0, changedProfiles: 0 });
      expect(JSON.stringify(result.users[0])).toBe(before);
    },
  );

  it.each(oneFieldHybrids())('rejects one-field hybrid: $name', ({ user }) => {
    // Given
    let captured: unknown;

    // When
    try {
      applyMemberAuthorityBackfill([user]);
    } catch (error: unknown) {
      captured = error;
    }

    // Then
    expect(captured).toBeInstanceOf(MemberAuthorityBackfillInvariantError);
  });

  it('retains duplicate student-ID detection across accepted terminal rows', () => {
    // Given
    const first = terminalUser(
      MemberKind.STUDENT,
      AffiliationKind.DEPARTMENT,
      20,
    );
    const secondBase = terminalUser(
      MemberKind.STUDENT,
      AffiliationKind.DEPARTMENT,
      21,
    );
    const second = {
      ...secondBase,
      studentId: first.studentId,
      profile: { ...secondBase.profile, studentId: first.studentId },
    };

    // When
    let captured: unknown;
    try {
      applyMemberAuthorityBackfill([first, second]);
    } catch (error: unknown) {
      captured = error;
    }

    // Then
    expect(captured).toMatchObject({ kind: 'DUPLICATE_STUDENT_ID' });
  });
});

function oneFieldHybrids(): readonly {
  readonly name: string;
  readonly user: MemberAuthorityBackfillUser;
}[] {
  const student = terminalUser(
    MemberKind.STUDENT,
    AffiliationKind.DEPARTMENT,
    10,
  );
  const staff = terminalUser(
    MemberKind.STAFF,
    AffiliationKind.PROGRAM_OFFICE,
    11,
  );
  return [
    { name: 'STUDENT role', user: { ...student, role: Role.STUDENT } },
    {
      name: 'STUDENT selected role',
      user: { ...student, selectedRole: Role.STUDENT },
    },
    {
      name: 'STUDENT selected kind',
      user: { ...student, selectedMemberKind: MemberKind.STAFF },
    },
    {
      name: 'STUDENT staff access',
      user: { ...student, hasStaffAccess: true },
    },
    {
      name: 'STUDENT admin access',
      user: { ...student, hasAdminAccess: false },
    },
    {
      name: 'STUDENT root name mirror',
      user: { ...student, name: '합성 불일치 이름' },
    },
    {
      name: 'STUDENT root student-ID mirror',
      user: { ...student, studentId: '749999' },
    },
    {
      name: 'STUDENT root affiliation mirror',
      user: { ...student, department: '합성 불일치 소속' },
    },
    {
      name: 'STUDENT profile kind',
      user: {
        ...student,
        profile: { ...student.profile, memberKind: MemberKind.STAFF },
      },
    },
    {
      name: 'STUDENT affiliation kind',
      user: {
        ...student,
        profile: {
          ...student.profile,
          affiliationKind: AffiliationKind.PROGRAM_OFFICE,
        },
      },
    },
    {
      name: 'STAFF selected kind',
      user: { ...staff, selectedMemberKind: MemberKind.STUDENT },
    },
    {
      name: 'STAFF staff access',
      user: { ...staff, hasStaffAccess: false },
    },
    {
      name: 'STAFF root student-ID mirror',
      user: { ...staff, studentId: '749998' },
    },
    {
      name: 'STAFF profile student-ID mirror',
      user: {
        ...staff,
        profile: { ...staff.profile, studentId: '749997' },
      },
    },
    {
      name: 'STAFF affiliation kind',
      user: {
        ...staff,
        profile: { ...staff.profile, affiliationKind: null },
      },
    },
  ];
}

function terminalUser(
  memberKind: MemberKind,
  affiliationKind: AffiliationKind,
  sequence: number,
): TerminalUser {
  const name = `합성 terminal 회원 ${sequence}`;
  const affiliationName = `합성 terminal 소속 ${sequence}`;
  const studentId = {
    [MemberKind.STUDENT]: `74${sequence.toString().padStart(4, '0')}`,
    [MemberKind.STAFF]: null,
  } satisfies Readonly<Record<MemberKind, string | null>>;
  const hasStaffAccess = {
    [MemberKind.STUDENT]: false,
    [MemberKind.STAFF]: true,
  } satisfies Readonly<Record<MemberKind, boolean>>;
  return {
    id: `synthetic-terminal-user-${sequence}`,
    githubId: (9_926_000_000n + BigInt(sequence)).toString(),
    nickname: `synthetic-terminal-${sequence}`,
    role: Role.ADMIN,
    selectedRole: null,
    selectedMemberKind: memberKind,
    hasStaffAccess: hasStaffAccess[memberKind],
    hasAdminAccess: true,
    name,
    studentId: studentId[memberKind],
    department: affiliationName,
    profile: {
      name,
      studentId: studentId[memberKind],
      department: affiliationName,
      memberKind,
      affiliationKind,
      affiliationName,
    },
  };
}
