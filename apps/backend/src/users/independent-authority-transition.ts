import { MemberKind } from '@prisma/client';
import { authorityLabel, type AuthorityLabel } from './domain/authority-label';

export const AUTHORITY_TARGETS = {
  STAFF: 'STAFF',
  ADMIN: 'ADMIN',
} as const;

export type AuthorityTarget =
  (typeof AUTHORITY_TARGETS)[keyof typeof AUTHORITY_TARGETS];

export type IndependentAuthorityState = {
  readonly memberKind: MemberKind | null;
  readonly selectedMemberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
};

export type IndependentAuthorityTransition = IndependentAuthorityState & {
  readonly role: AuthorityLabel | null;
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
    selectedMemberKind: before.memberKind ?? before.selectedMemberKind,
    hasStaffAccess,
    hasAdminAccess,
    role: authorityLabel({
      memberKind: before.memberKind,
      hasStaffAccess,
      hasAdminAccess,
    }),
  };
}
