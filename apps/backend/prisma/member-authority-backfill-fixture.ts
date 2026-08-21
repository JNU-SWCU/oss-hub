import {
  AffiliationKind,
  MemberKind,
  Role,
  RoleRequestStatus,
} from '@prisma/client';
import { memberAuthorityAggregate } from './member-authority-backfill-aggregate';
import { applyMemberAuthorityBackfill } from './member-authority-backfill-core';
import {
  MEMBER_AUTHORITY_BACKFILL_VERSION,
  type MemberAuthorityBackfillUser,
  type MemberAuthorityRequestSnapshot,
} from './member-authority-backfill-types';

type ParsedFixture = {
  readonly users: readonly MemberAuthorityBackfillUser[];
  readonly requests: readonly MemberAuthorityRequestSnapshot[];
};

export function runMemberAuthorityFixture(value: unknown) {
  const fixture = parseMemberAuthorityFixture(value);
  const before = memberAuthorityAggregate(fixture.users, fixture.requests);
  const first = applyMemberAuthorityBackfill(fixture.users);
  const after = memberAuthorityAggregate(first.users, fixture.requests);
  const second = applyMemberAuthorityBackfill(first.users);
  return {
    version: MEMBER_AUTHORITY_BACKFILL_VERSION,
    fixture: {
      users: before.users,
      legacyRoles: before.legacyRoles,
      requests: before.requests,
    },
    firstRun: {
      changedUsers: first.changedUsers,
      changedProfiles: first.changedProfiles,
      createdProfiles: first.createdProfiles,
      clearedNonStudentIds: first.clearedNonStudentIds,
    },
    secondRun: {
      changedUsers: second.changedUsers,
      changedProfiles: second.changedProfiles,
    },
    aggregate: after,
    preserved: {
      userIds: sameStrings(
        fixture.users.map(({ id }) => id),
        first.users.map(({ id }) => id),
      ),
      accountIds: sameStrings(
        fixture.users.map(({ githubId }) => githubId),
        first.users.map(({ githubId }) => githubId),
      ),
      requestHistory: fixture.requests.length === after.requests,
    },
  };
}

export function parseMemberAuthorityFixture(value: unknown): ParsedFixture {
  const fixture = record(value);
  if (
    fixture.version !== 1 ||
    !Array.isArray(fixture.users) ||
    !Array.isArray(fixture.requests)
  ) {
    throw new TypeError('Unsupported member authority fixture');
  }
  return {
    users: fixture.users.map(parseUser),
    requests: fixture.requests.map(parseRequest),
  };
}

function parseUser(value: unknown): MemberAuthorityBackfillUser {
  const user = record(value);
  return {
    id: text(user.id),
    githubId: text(user.githubId),
    nickname: text(user.nickname),
    role: nullableRole(user.role),
    selectedRole: nullableRole(user.selectedRole),
    selectedMemberKind: nullableMemberKind(user.selectedMemberKind),
    hasStaffAccess: nullableBoolean(user.hasStaffAccess),
    hasAdminAccess: nullableBoolean(user.hasAdminAccess),
    name: nullableText(user.name),
    studentId: nullableText(user.studentId),
    department: nullableText(user.department),
    profile: user.profile === null ? null : parseProfile(user.profile),
  };
}

function parseProfile(value: unknown) {
  const profile = record(value);
  return {
    name: text(profile.name),
    studentId: nullableText(profile.studentId),
    department: text(profile.department),
    memberKind: nullableMemberKind(profile.memberKind),
    affiliationKind: nullableAffiliationKind(profile.affiliationKind),
    affiliationName: nullableText(profile.affiliationName),
  };
}

function parseRequest(value: unknown): MemberAuthorityRequestSnapshot {
  const request = record(value);
  return {
    id: text(request.id),
    userId: text(request.userId),
    status: roleRequestStatus(request.status),
    decidedById: nullableText(request.decidedById),
  };
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Expected fixture object');
  }
  return Object.fromEntries(Object.entries(value));
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Expected fixture string');
  return value;
}

function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}

function nullableBoolean(value: unknown): boolean | null {
  if (value === null || typeof value === 'boolean') return value;
  throw new TypeError('Expected fixture boolean');
}

function nullableRole(value: unknown): Role | null {
  if (value === null) return null;
  switch (value) {
    case Role.STUDENT:
      return Role.STUDENT;
    case Role.STAFF:
      return Role.STAFF;
    case Role.ADMIN:
      return Role.ADMIN;
    default:
      throw new TypeError('Unsupported fixture role');
  }
}

function nullableMemberKind(value: unknown): MemberKind | null {
  if (value === null) return null;
  switch (value) {
    case MemberKind.STUDENT:
      return MemberKind.STUDENT;
    case MemberKind.STAFF:
      return MemberKind.STAFF;
    default:
      throw new TypeError('Unsupported fixture member kind');
  }
}

function nullableAffiliationKind(value: unknown): AffiliationKind | null {
  if (value === null) return null;
  switch (value) {
    case AffiliationKind.DEPARTMENT:
      return AffiliationKind.DEPARTMENT;
    case AffiliationKind.PROGRAM_OFFICE:
      return AffiliationKind.PROGRAM_OFFICE;
    default:
      throw new TypeError('Unsupported fixture affiliation kind');
  }
}

function roleRequestStatus(value: unknown): RoleRequestStatus {
  switch (value) {
    case RoleRequestStatus.PENDING:
    case RoleRequestStatus.APPROVED:
    case RoleRequestStatus.REJECTED:
    case RoleRequestStatus.REVOKED:
      return value;
    default:
      throw new TypeError('Unsupported fixture request status');
  }
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
