import { MemberKind, Role } from '@prisma/client';
import type { MemberAuthorityBackfillUser } from './member-authority-backfill-types';

export const MEMBER_AUTHORITY_BACKFILL_ERROR_KIND = {
  INVALID_PROFILE_SOURCE: 'INVALID_PROFILE_SOURCE',
  UNKNOWN_SELECTION_COMBINATION: 'UNKNOWN_SELECTION_COMBINATION',
  DUPLICATE_STUDENT_ID: 'DUPLICATE_STUDENT_ID',
  UNAPPROVED_PROFILE_MISMATCH: 'UNAPPROVED_PROFILE_MISMATCH',
} as const;

export type MemberAuthorityBackfillErrorKind =
  (typeof MEMBER_AUTHORITY_BACKFILL_ERROR_KIND)[keyof typeof MEMBER_AUTHORITY_BACKFILL_ERROR_KIND];

export class MemberAuthorityBackfillInvariantError extends Error {
  override readonly name = 'MemberAuthorityBackfillInvariantError';

  constructor(
    readonly kind: MemberAuthorityBackfillErrorKind,
    readonly affectedCount: number,
  ) {
    super(
      `Member authority backfill invariant failed: ${kind}; count=${affectedCount}`,
    );
  }
}

export function requireKnownSelection(user: MemberAuthorityBackfillUser): void {
  const selected = user.selectedMemberKind;
  const selectedFromLegacyRole = legacySelectedMemberKind(user.selectedRole);
  const canonical = user.profile?.memberKind ?? null;
  const incompatible =
    user.selectedRole === Role.ADMIN ||
    (selected !== null &&
      selectedFromLegacyRole !== null &&
      selected !== selectedFromLegacyRole) ||
    (canonical === null &&
      user.role === Role.STUDENT &&
      selected === MemberKind.STAFF) ||
    (canonical === null &&
      user.role === Role.STAFF &&
      selected === MemberKind.STUDENT) ||
    (canonical === null && user.role === Role.ADMIN && selected !== null) ||
    (canonical !== null && selected !== null && canonical !== selected);
  if (incompatible) throw backfillInvariant('UNKNOWN_SELECTION_COMBINATION');
}

export function requireApprovedProfileSource(
  user: MemberAuthorityBackfillUser,
): void {
  const profile = user.profile;
  if (profile === null) return;
  const mismatched =
    (user.name !== null && user.name !== profile.name) ||
    (user.department !== null && user.department !== profile.department) ||
    (profile.affiliationName !== null &&
      profile.affiliationName !== profile.department);
  if (mismatched) {
    throw backfillInvariant('UNAPPROVED_PROFILE_MISMATCH');
  }
}

export function legacySelectedMemberKind(role: Role | null): MemberKind | null {
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

export function backfillInvariant(
  kind: MemberAuthorityBackfillErrorKind,
): MemberAuthorityBackfillInvariantError {
  return new MemberAuthorityBackfillInvariantError(kind, 1);
}
