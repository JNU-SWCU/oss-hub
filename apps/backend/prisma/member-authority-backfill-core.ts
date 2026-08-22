import { AffiliationKind, MemberKind, Role } from '@prisma/client';
import {
  isStoredStudentId,
  isValidDepartment,
  isValidUserName,
} from '../src/users/user-profile-policy';
import {
  requireAcceptedMachineState,
  requireIdempotentProjection,
} from './member-authority-backfill-state';
import type {
  MemberAuthorityBackfillProfile,
  MemberAuthorityBackfillResult,
  MemberAuthorityBackfillUser,
} from './member-authority-backfill-types';
import {
  backfillInvariant,
  projectedSelectedMemberKind,
  requireApprovedProfileSource,
} from './member-authority-backfill-validation';

export {
  MEMBER_AUTHORITY_BACKFILL_ERROR_KIND,
  MemberAuthorityBackfillInvariantError,
  type MemberAuthorityBackfillErrorKind,
} from './member-authority-backfill-validation';

export function applyMemberAuthorityBackfill(
  users: readonly MemberAuthorityBackfillUser[],
): MemberAuthorityBackfillResult {
  const nextUsers = projectUsers(users);
  requireIdempotentProjection(nextUsers, projectUsers);
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

function projectUsers(
  users: readonly MemberAuthorityBackfillUser[],
): readonly MemberAuthorityBackfillUser[] {
  const studentIds = new Set<string>();
  return users.map((user) => projectUser(user, studentIds));
}

function projectUser(
  user: MemberAuthorityBackfillUser,
  studentIds: Set<string>,
): MemberAuthorityBackfillUser {
  requireApprovedProfileSource(user);
  requireAcceptedMachineState(user, (selectedMemberKind) =>
    projectSelectedUser({ ...user, selectedMemberKind }, new Set<string>()),
  );
  return projectSelectedUser(
    { ...user, selectedMemberKind: projectedSelectedMemberKind(user) },
    studentIds,
  );
}

function projectSelectedUser(
  selectedUser: MemberAuthorityBackfillUser,
  studentIds: Set<string>,
): MemberAuthorityBackfillUser {
  switch (selectedUser.role) {
    case Role.STUDENT:
      return projectMember(
        selectedUser,
        MemberKind.STUDENT,
        false,
        false,
        studentIds,
      );
    case Role.STAFF:
      return projectMember(
        selectedUser,
        MemberKind.STAFF,
        true,
        false,
        studentIds,
      );
    case Role.ADMIN:
      return projectUnresolvedAdmin(selectedUser);
    case null: {
      const canonicalKind = selectedUser.profile?.memberKind ?? null;
      return canonicalKind === null
        ? { ...selectedUser, hasStaffAccess: false, hasAdminAccess: false }
        : projectCanonicalUser(selectedUser, canonicalKind, studentIds);
    }
  }
}

function projectCanonicalUser(
  user: MemberAuthorityBackfillUser,
  memberKind: MemberKind,
  studentIds: Set<string>,
): MemberAuthorityBackfillUser {
  return projectMember(
    user,
    memberKind,
    user.hasStaffAccess ?? user.role === Role.STAFF,
    user.hasAdminAccess ?? user.role === Role.ADMIN,
    studentIds,
  );
}

function projectMember(
  user: MemberAuthorityBackfillUser,
  memberKind: MemberKind,
  hasStaffAccess: boolean,
  hasAdminAccess: boolean,
  studentIds: Set<string>,
): MemberAuthorityBackfillUser {
  const profile = requireMemberProfile(user, memberKind, studentIds);
  return {
    ...user,
    name: profile.name,
    studentId: profile.studentId,
    department: profile.department,
    hasStaffAccess,
    hasAdminAccess,
    profile,
  };
}

function requireMemberProfile(
  user: MemberAuthorityBackfillUser,
  memberKind: MemberKind,
  studentIds: Set<string>,
): MemberAuthorityBackfillProfile {
  const name = user.profile?.name ?? user.name;
  const affiliationName =
    user.profile?.affiliationName ??
    user.profile?.department ??
    user.department;
  if (
    name === null ||
    affiliationName === null ||
    !isValidUserName(name) ||
    !isValidDepartment(affiliationName)
  ) {
    throw backfillInvariant('INVALID_PROFILE_SOURCE');
  }
  const affiliationKind =
    user.profile?.affiliationKind ?? AffiliationKind.DEPARTMENT;
  if (
    memberKind === MemberKind.STUDENT &&
    affiliationKind !== AffiliationKind.DEPARTMENT
  ) {
    throw backfillInvariant('INVALID_PROFILE_SOURCE');
  }
  const studentId =
    memberKind === MemberKind.STUDENT
      ? (user.profile?.studentId ?? user.studentId)
      : null;
  if (
    memberKind === MemberKind.STUDENT &&
    (studentId === null || !isStoredStudentId(studentId))
  ) {
    throw backfillInvariant('INVALID_PROFILE_SOURCE');
  }
  if (studentId !== null) {
    if (studentIds.has(studentId)) {
      throw backfillInvariant('DUPLICATE_STUDENT_ID');
    }
    studentIds.add(studentId);
  }
  return {
    name,
    studentId,
    department: affiliationName,
    memberKind,
    affiliationKind,
    affiliationName,
  };
}

function projectUnresolvedAdmin(
  user: MemberAuthorityBackfillUser,
): MemberAuthorityBackfillUser {
  const name = user.profile?.name ?? user.name;
  const department = user.profile?.department ?? user.department;
  if (
    name === null ||
    department === null ||
    !isValidUserName(name) ||
    !isValidDepartment(department)
  ) {
    throw backfillInvariant('INVALID_PROFILE_SOURCE');
  }
  return {
    ...user,
    name,
    studentId: null,
    department,
    hasStaffAccess: true,
    hasAdminAccess: true,
    profile: {
      name,
      studentId: null,
      department,
      memberKind: null,
      affiliationKind: null,
      affiliationName: null,
    },
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
