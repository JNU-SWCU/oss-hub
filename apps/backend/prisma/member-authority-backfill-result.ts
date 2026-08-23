import type {
  MemberAuthorityBackfillProfile,
  MemberAuthorityBackfillResult,
  MemberAuthorityBackfillUser,
} from './member-authority-backfill-types';

export function memberAuthorityBackfillResult(
  users: readonly MemberAuthorityBackfillUser[],
  nextUsers: readonly MemberAuthorityBackfillUser[],
): MemberAuthorityBackfillResult {
  let changedUsers = 0;
  let changedProfiles = 0;
  let createdProfiles = 0;
  let clearedNonStudentIds = 0;
  for (const [index, user] of users.entries()) {
    const nextUser = nextUsers[index];
    if (nextUser === undefined) continue;
    if (!sameUser(user, nextUser)) changedUsers += 1;
    if (!sameProfile(user.profile, nextUser.profile)) changedProfiles += 1;
    if (user.profile === null && nextUser.profile !== null)
      createdProfiles += 1;
    if (
      user.profile?.studentId !== null &&
      user.profile?.studentId !== undefined &&
      nextUser.profile?.studentId === null
    ) {
      clearedNonStudentIds += 1;
    }
  }
  return {
    users: nextUsers,
    changedUsers,
    changedProfiles,
    createdProfiles,
    clearedNonStudentIds,
  };
}

function sameUser(
  before: MemberAuthorityBackfillUser,
  after: MemberAuthorityBackfillUser,
): boolean {
  return (
    before.selectedMemberKind === after.selectedMemberKind &&
    before.name === after.name &&
    before.studentId === after.studentId &&
    before.department === after.department &&
    before.hasStaffAccess === after.hasStaffAccess &&
    before.hasAdminAccess === after.hasAdminAccess &&
    sameProfile(before.profile, after.profile)
  );
}

function sameProfile(
  before: MemberAuthorityBackfillProfile | null,
  after: MemberAuthorityBackfillProfile | null,
): boolean {
  if (before === null || after === null) return before === after;
  return (
    before.name === after.name &&
    before.studentId === after.studentId &&
    before.department === after.department &&
    before.memberKind === after.memberKind &&
    before.affiliationKind === after.affiliationKind &&
    before.affiliationName === after.affiliationName
  );
}
