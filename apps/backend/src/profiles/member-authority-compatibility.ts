import { AffiliationKind, MemberKind, Role } from '@prisma/client';
import {
  isCompleteProfileFields,
  isValidCompleteUserProfileFields,
} from '../users/user-profile-policy';

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

export type CanonicalProfileCompatibilitySource =
  MemberAuthorityCompatibilitySource & {
    readonly name: string | null;
    readonly studentId: string | null;
    readonly profile: {
      readonly name: string;
      readonly studentId: string | null;
      readonly department: string;
      readonly memberKind: MemberKind | null;
      readonly affiliationKind: AffiliationKind | null;
      readonly affiliationName: string | null;
    } | null;
  };

/**
 * 접근 권한만 보는 좁은 면. 이름·학과를 끌고 오지 않는다 — 인가 가드가
 * 실명을 읽을 이유가 없다(AGENTS.md §4 redact-later 금지).
 */
export type MemberAccessSource = {
  readonly role: Role | null;
  readonly hasStaffAccess?: boolean | null;
  readonly hasAdminAccess?: boolean | null;
};

export type MemberAccess = {
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
};

/** 정본은 canonical 컬럼. expand 단계의 null 행만 legacy `role`로 떨어진다. */
export function resolveMemberAccess(source: MemberAccessSource): MemberAccess {
  return {
    hasStaffAccess: source.hasStaffAccess ?? legacyHasStaffAccess(source.role),
    hasAdminAccess: source.hasAdminAccess ?? source.role === Role.ADMIN,
  };
}

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
  const { hasStaffAccess, hasAdminAccess } = resolveMemberAccess(source);
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
      ? projectLegacyAuthorityRole(memberKind, hasStaffAccess, hasAdminAccess)
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

export function isCompatibleCanonicalProfile(
  source: CanonicalProfileCompatibilitySource,
): boolean {
  const profile = source.profile;
  if (!hasCanonicalCompatibilityFields(profile)) {
    return false;
  }

  const projection = resolveMemberAuthorityCompatibility(source);
  if (!matchesCanonicalProjection(source, projection, profile)) {
    return false;
  }

  return isCompleteCanonicalProfile(profile);
}

type CanonicalCompatibilityProfile = NonNullable<
  CanonicalProfileCompatibilitySource['profile']
>;

function hasCanonicalCompatibilityFields(
  profile: CanonicalProfileCompatibilitySource['profile'],
): profile is CanonicalCompatibilityProfile {
  return (
    profile !== null &&
    profile.memberKind !== null &&
    profile.affiliationKind !== null &&
    profile.affiliationName !== null
  );
}

function matchesCanonicalProjection(
  source: CanonicalProfileCompatibilitySource,
  projection: MemberAuthorityProjection,
  profile: CanonicalCompatibilityProfile,
): boolean {
  return (
    projection.memberKind === profile.memberKind &&
    projection.affiliationKind === profile.affiliationKind &&
    projection.affiliationName === profile.affiliationName &&
    source.name === profile.name &&
    source.studentId === profile.studentId &&
    source.department === profile.department &&
    profile.department === profile.affiliationName
  );
}

function isCompleteCanonicalProfile(
  profile: CanonicalCompatibilityProfile,
): boolean {
  if (profile.memberKind === MemberKind.STUDENT) {
    return (
      profile.affiliationKind === AffiliationKind.DEPARTMENT &&
      profile.studentId !== null &&
      isValidCompleteUserProfileFields({
        name: profile.name,
        studentId: profile.studentId,
        department: profile.department,
      })
    );
  }

  return (
    profile.studentId === null && isCompleteProfileFields(profile, Role.STAFF)
  );
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

export function projectLegacyAuthorityRole(
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
