import { MemberKind, Role } from '@prisma/client';
import { projectLegacyAuthorityRole } from '../profiles/member-authority-compatibility';

export const AUTHORITY_TARGETS = {
  STAFF: 'STAFF',
  ADMIN: 'ADMIN',
} as const;

export type AuthorityTarget =
  (typeof AUTHORITY_TARGETS)[keyof typeof AUTHORITY_TARGETS];

export type IndependentAuthorityState = {
  readonly memberKind: MemberKind | null;
  readonly selectedRole: Role | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
};

export type IndependentAuthorityTransition = IndependentAuthorityState & {
  readonly role: Role | null;
};

export function resolveIndependentAuthorityTransition(
  before: IndependentAuthorityState,
  target: AuthorityTarget,
  enabled: boolean,
): IndependentAuthorityTransition {
  const hasStaffAccess =
    target === AUTHORITY_TARGETS.STAFF ? enabled : before.hasStaffAccess;
  const hasAdminAccess =
    target === AUTHORITY_TARGETS.ADMIN ? enabled : before.hasAdminAccess;
  return {
    memberKind: before.memberKind,
    selectedRole: selectedRoleForMember(before.memberKind, before.selectedRole),
    hasStaffAccess,
    hasAdminAccess,
    role: projectLegacyAuthorityRole(
      before.memberKind,
      hasStaffAccess,
      hasAdminAccess,
    ),
  };
}

function selectedRoleForMember(
  memberKind: MemberKind | null,
  fallback: Role | null,
): Role | null {
  switch (memberKind) {
    case MemberKind.STUDENT:
      return Role.STUDENT;
    case MemberKind.STAFF:
      return Role.STAFF;
    case null:
      return fallback;
  }
}
