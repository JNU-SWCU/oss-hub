import { MemberKind, Role } from '@prisma/client';
import type { MemberAuthorityBackfillUser } from './member-authority-backfill-types';

export const MEMBER_AUTHORITY_BACKFILL_ERROR_KIND = {
  INVALID_PROFILE_SOURCE: 'INVALID_PROFILE_SOURCE',
  UNKNOWN_SELECTION_COMBINATION: 'UNKNOWN_SELECTION_COMBINATION',
  DUPLICATE_STUDENT_ID: 'DUPLICATE_STUDENT_ID',
  UNAPPROVED_PROFILE_MISMATCH: 'UNAPPROVED_PROFILE_MISMATCH',
  NON_IDEMPOTENT_PROJECTION: 'NON_IDEMPOTENT_PROJECTION',
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
  if (user.selectedRole === Role.ADMIN) {
    throw backfillInvariant('UNKNOWN_SELECTION_COMBINATION');
  }
  if (user.role === null) {
    const incompatible =
      (selected !== null &&
        selectedFromLegacyRole !== null &&
        selected !== selectedFromLegacyRole) ||
      (canonical !== null && selected !== null && canonical !== selected);
    if (incompatible) throw backfillInvariant('UNKNOWN_SELECTION_COMBINATION');
    return;
  }

  const expected = assignedMemberKind(user.role);
  const canonicalConflict =
    user.role === Role.ADMIN
      ? canonical !== null
      : canonical !== null && canonical !== expected;
  const selectionConflict = selected !== null && selected !== expected;
  if (
    canonicalConflict ||
    (selectionConflict && !isExactV1SelectionConflict(user, expected)) ||
    (canonical !== null && !hasCompatibleCanonicalAccess(user))
  ) {
    throw backfillInvariant('UNKNOWN_SELECTION_COMBINATION');
  }
}

export function projectedSelectedMemberKind(
  user: MemberAuthorityBackfillUser,
): MemberKind | null {
  return user.role === null
    ? (user.selectedMemberKind ?? legacySelectedMemberKind(user.selectedRole))
    : assignedMemberKind(user.role);
}

function assignedMemberKind(role: Role): MemberKind | null {
  switch (role) {
    case Role.STUDENT:
      return MemberKind.STUDENT;
    case Role.STAFF:
      return MemberKind.STAFF;
    case Role.ADMIN:
      return null;
  }
}

function isExactV1SelectionConflict(
  user: MemberAuthorityBackfillUser,
  expected: MemberKind | null,
): boolean {
  const staleSelection = legacySelectedMemberKind(user.selectedRole);
  if (
    staleSelection === null ||
    staleSelection === expected ||
    user.selectedMemberKind !== staleSelection
  ) {
    return false;
  }
  const canonical = user.profile?.memberKind ?? null;
  switch (user.role) {
    case Role.STUDENT:
      return (
        canonical === MemberKind.STUDENT &&
        user.hasStaffAccess === false &&
        user.hasAdminAccess === false
      );
    case Role.STAFF:
      return (
        canonical === MemberKind.STAFF &&
        user.hasStaffAccess === true &&
        user.hasAdminAccess === false
      );
    case Role.ADMIN:
      return (
        canonical === null &&
        user.hasStaffAccess === true &&
        user.hasAdminAccess === true
      );
    case null:
      return false;
  }
}

function hasCompatibleCanonicalAccess(
  user: MemberAuthorityBackfillUser,
): boolean {
  const expectedStaff = user.role !== Role.STUDENT;
  const expectedAdmin = user.role === Role.ADMIN;
  return (
    (user.hasStaffAccess === null || user.hasStaffAccess === expectedStaff) &&
    (user.hasAdminAccess === null || user.hasAdminAccess === expectedAdmin)
  );
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
  affectedCount = 1,
): MemberAuthorityBackfillInvariantError {
  return new MemberAuthorityBackfillInvariantError(kind, affectedCount);
}
