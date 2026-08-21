import { AffiliationKind, MemberKind, Role } from '@prisma/client';
import { resolveMemberAuthorityCompatibility } from './member-authority-compatibility';

const EMPTY_SELECTION = {
  selectedRole: null,
  selectedMemberKind: null,
} as const;

describe('member authority compatibility projection', () => {
  it.each([
    {
      label: 'canonical student admin',
      source: {
        ...EMPTY_SELECTION,
        role: Role.ADMIN,
        department: '레거시 학부',
        profile: {
          department: '프로필 인공지능학부',
          memberKind: MemberKind.STUDENT,
          affiliationKind: AffiliationKind.DEPARTMENT,
          affiliationName: '인공지능학부',
        },
        hasStaffAccess: false,
        hasAdminAccess: true,
      },
      expected: {
        role: Role.ADMIN,
        selectedMemberKind: null,
        memberKind: MemberKind.STUDENT,
        affiliationKind: AffiliationKind.DEPARTMENT,
        affiliationName: '인공지능학부',
        hasStaffAccess: false,
        hasAdminAccess: true,
      },
    },
    {
      label: 'canonical revoked staff',
      source: {
        ...EMPTY_SELECTION,
        role: Role.STAFF,
        department: '레거시 사업단',
        profile: {
          department: '프로필 합성 사업단',
          memberKind: MemberKind.STAFF,
          affiliationKind: AffiliationKind.PROGRAM_OFFICE,
          affiliationName: '합성 사업단',
        },
        hasStaffAccess: false,
        hasAdminAccess: false,
      },
      expected: {
        role: null,
        selectedMemberKind: null,
        memberKind: MemberKind.STAFF,
        affiliationKind: AffiliationKind.PROGRAM_OFFICE,
        affiliationName: '합성 사업단',
        hasStaffAccess: false,
        hasAdminAccess: false,
      },
    },
    {
      label: 'unresolved legacy staff',
      source: {
        selectedRole: Role.STAFF,
        selectedMemberKind: null,
        role: Role.STAFF,
        department: '소프트웨어공학과',
        profile: null,
        hasStaffAccess: null,
        hasAdminAccess: null,
      },
      expected: {
        role: Role.STAFF,
        selectedMemberKind: MemberKind.STAFF,
        memberKind: MemberKind.STAFF,
        affiliationKind: AffiliationKind.DEPARTMENT,
        affiliationName: '소프트웨어공학과',
        hasStaffAccess: true,
        hasAdminAccess: false,
      },
    },
    {
      label: 'unresolved legacy admin',
      source: {
        ...EMPTY_SELECTION,
        role: Role.ADMIN,
        department: null,
        profile: null,
        hasStaffAccess: null,
        hasAdminAccess: null,
      },
      expected: {
        role: Role.ADMIN,
        selectedMemberKind: null,
        memberKind: null,
        affiliationKind: null,
        affiliationName: null,
        hasStaffAccess: true,
        hasAdminAccess: true,
      },
    },
  ] as const)('prefers canonical facts for $label', ({ source, expected }) => {
    // Given: canonical facts may be complete or unresolved on a legacy row.
    // When: the single compatibility projection resolves the application view.
    const projection = resolveMemberAuthorityCompatibility(source);

    // Then: canonical values win and Role is used only for unresolved facts.
    expect(projection).toEqual(expected);
  });

  it('does not imply staff access from canonical admin access', () => {
    // Given
    const source = {
      ...EMPTY_SELECTION,
      role: Role.ADMIN,
      department: '인공지능학부',
      profile: {
        department: '프로필 인공지능학부',
        memberKind: MemberKind.STUDENT,
        affiliationKind: AffiliationKind.DEPARTMENT,
        affiliationName: '인공지능학부',
      },
      hasStaffAccess: false,
      hasAdminAccess: true,
    } as const;

    // When
    const projection = resolveMemberAuthorityCompatibility(source);

    // Then
    expect(projection.hasAdminAccess).toBe(true);
    expect(projection.hasStaffAccess).toBe(false);
  });
});
