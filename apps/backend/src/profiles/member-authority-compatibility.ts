import { AffiliationKind, MemberKind, Role } from '@prisma/client';

export type MemberAuthorityCompatibilitySource = {
  readonly role: Role | null;
  readonly selectedRole: Role | null;
  readonly selectedMemberKind?: MemberKind | null;
  readonly department: string | null;
  readonly hasStaffAccess?: boolean | null;
  readonly hasAdminAccess?: boolean | null;
  readonly profile: {
    readonly department: string;
    readonly memberKind?: MemberKind | null;
    readonly affiliationKind?: AffiliationKind | null;
    readonly affiliationName?: string | null;
  } | null;
};

export type MemberAuthorityProjection = {
  readonly role: Role | null;
  readonly selectedMemberKind: MemberKind | null;
  readonly memberKind: MemberKind | null;
  readonly affiliationKind: AffiliationKind | null;
  readonly affiliationName: string | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
};

/** Canonical member and authority facts win; nullable expand rows fall back here only. */
export function resolveMemberAuthorityCompatibility(
  source: MemberAuthorityCompatibilitySource,
): MemberAuthorityProjection {
  const memberKind =
    source.profile?.memberKind ?? legacyMemberKind(source.role);
  const hasStaffAccess =
    source.hasStaffAccess ?? legacyHasStaffAccess(source.role);
  const hasAdminAccess = source.hasAdminAccess ?? source.role === Role.ADMIN;
  const affiliationName =
    source.profile?.affiliationName ??
    source.profile?.department ??
    source.department;
  const hasCanonicalFact =
    (source.profile?.memberKind ?? null) !== null ||
    (source.hasStaffAccess ?? null) !== null ||
    (source.hasAdminAccess ?? null) !== null;

  return {
    role: hasCanonicalFact
      ? projectLegacyRole(memberKind, hasStaffAccess, hasAdminAccess)
      : source.role,
    selectedMemberKind:
      source.selectedMemberKind ?? legacyMemberKind(source.selectedRole),
    memberKind,
    affiliationKind:
      source.profile?.affiliationKind ??
      (affiliationName === null ? null : AffiliationKind.DEPARTMENT),
    affiliationName,
    hasStaffAccess,
    hasAdminAccess,
  };
}

function legacyMemberKind(role: Role | null): MemberKind | null {
  switch (role) {
    case Role.STUDENT:
      return MemberKind.STUDENT;
    case Role.STAFF:
      return MemberKind.STAFF;
    case Role.ADMIN:
    case null:
      return null;
  }
}

function legacyHasStaffAccess(role: Role | null): boolean {
  switch (role) {
    case Role.STAFF:
    case Role.ADMIN:
      return true;
    case Role.STUDENT:
    case null:
      return false;
  }
}

function projectLegacyRole(
  memberKind: MemberKind | null,
  hasStaffAccess: boolean,
  hasAdminAccess: boolean,
): Role | null {
  if (hasAdminAccess) {
    return Role.ADMIN;
  }
  if (hasStaffAccess) {
    return Role.STAFF;
  }
  return memberKind === MemberKind.STUDENT ? Role.STUDENT : null;
}
