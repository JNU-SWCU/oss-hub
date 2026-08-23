import { Role } from '@prisma/client';
import type { MemberAuthorityBackfillUser } from './member-authority-backfill-types';
import {
  backfillInvariant,
  legacySelectedMemberKind,
  projectedSelectedMemberKind,
} from './member-authority-backfill-validation';

type ProjectionCandidate = (
  selectedMemberKind: MemberAuthorityBackfillUser['selectedMemberKind'],
) => MemberAuthorityBackfillUser;

type ProjectionCandidates = {
  readonly selected: ProjectionCandidate;
  readonly terminal: (
    memberKind: NonNullable<MemberAuthorityBackfillUser['selectedMemberKind']>,
  ) => MemberAuthorityBackfillUser;
};

type ProjectUsers = (
  users: readonly MemberAuthorityBackfillUser[],
) => readonly MemberAuthorityBackfillUser[];

export function requireIdempotentProjection(
  users: readonly MemberAuthorityBackfillUser[],
  projectUsers: ProjectUsers,
): void {
  const repeatedUsers = projectUsers(users);
  const affectedCount = users.filter(
    (user, index) =>
      JSON.stringify(user) !== JSON.stringify(repeatedUsers[index]),
  ).length;
  if (affectedCount > 0) {
    throw backfillInvariant('NON_IDEMPOTENT_PROJECTION', affectedCount);
  }
}

export function requireAcceptedMachineState(
  user: MemberAuthorityBackfillUser,
  projectCandidate: ProjectionCandidates,
): MemberAuthorityBackfillUser | null {
  if (user.selectedRole === Role.ADMIN) {
    throw backfillInvariant('UNKNOWN_SELECTION_COMBINATION');
  }
  if (
    user.role === Role.ADMIN &&
    user.selectedMemberKind !== null &&
    (user.selectedRole === null ||
      legacySelectedMemberKind(user.selectedRole) === user.selectedMemberKind)
  ) {
    const exactTerminal = projectCandidate.terminal(user.selectedMemberKind);
    if (sameState(user, exactTerminal)) return exactTerminal;
  }
  if (isPristineState(user)) return null;

  const exactV1 = projectCandidate.selected(
    legacySelectedMemberKind(user.selectedRole),
  );
  if (sameState(user, exactV1)) return null;

  const exactV2 = projectCandidate.selected(projectedSelectedMemberKind(user));
  if (sameState(user, exactV2)) return null;

  throw backfillInvariant('UNKNOWN_SELECTION_COMBINATION');
}

function isPristineState(user: MemberAuthorityBackfillUser): boolean {
  return (
    user.selectedMemberKind === null &&
    user.hasStaffAccess === null &&
    user.hasAdminAccess === null &&
    (user.profile === null ||
      (user.profile.memberKind === null &&
        user.profile.affiliationKind === null &&
        user.profile.affiliationName === null))
  );
}

function sameState(
  before: MemberAuthorityBackfillUser,
  after: MemberAuthorityBackfillUser,
): boolean {
  return JSON.stringify(before) === JSON.stringify(after);
}
