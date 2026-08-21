import { createHash } from 'node:crypto';
import { MemberKind, Role, RoleRequestStatus } from '@prisma/client';
import type {
  MemberAuthorityAggregate,
  MemberAuthorityBackfillUser,
  MemberAuthorityRequestSnapshot,
} from './member-authority-backfill-types';

export function memberAuthorityAggregate(
  users: readonly MemberAuthorityBackfillUser[],
  requests: readonly MemberAuthorityRequestSnapshot[],
): MemberAuthorityAggregate {
  const legacyRoles = { STUDENT: 0, STAFF: 0, ADMIN: 0, UNASSIGNED: 0 };
  const memberKinds = { STUDENT: 0, STAFF: 0, UNRESOLVED_ASSIGNED: 0 };
  const selectedMemberKinds = { STUDENT: 0, STAFF: 0, UNRESOLVED: 0 };
  const unassignedMemberKinds = { STUDENT: 0, STAFF: 0, UNRESOLVED: 0 };
  const backfillTargets = {
    memberKinds: { STUDENT: 0, STAFF: 0 },
    selectedMemberKinds: { STUDENT: 0, STAFF: 0 },
  };
  const requestStatuses = {
    PENDING: 0,
    APPROVED: 0,
    REJECTED: 0,
    REVOKED: 0,
  } satisfies Record<RoleRequestStatus, number>;
  let profiles = 0;
  let staffAccess = 0;
  let adminAccess = 0;
  let compatibilityOnlyAdminAuthorities = 0;

  for (const user of users) {
    legacyRoles[user.role ?? 'UNASSIGNED'] += 1;
    if (user.profile !== null) profiles += 1;
    const memberKind = user.profile?.memberKind ?? null;
    if (memberKind === MemberKind.STUDENT) memberKinds.STUDENT += 1;
    if (memberKind === MemberKind.STAFF) memberKinds.STAFF += 1;
    if (user.role !== null && memberKind === null) {
      memberKinds.UNRESOLVED_ASSIGNED += 1;
    }
    selectedMemberKinds[user.selectedMemberKind ?? 'UNRESOLVED'] += 1;
    if (user.role === null) {
      unassignedMemberKinds[memberKind ?? 'UNRESOLVED'] += 1;
    }
    if (memberKind === null && user.role === Role.STUDENT) {
      backfillTargets.memberKinds.STUDENT += 1;
    }
    if (memberKind === null && user.role === Role.STAFF) {
      backfillTargets.memberKinds.STAFF += 1;
    }
    if (
      user.selectedMemberKind === null &&
      user.selectedRole === Role.STUDENT
    ) {
      backfillTargets.selectedMemberKinds.STUDENT += 1;
    }
    if (user.selectedMemberKind === null && user.selectedRole === Role.STAFF) {
      backfillTargets.selectedMemberKinds.STAFF += 1;
    }
    if (user.hasStaffAccess === true) staffAccess += 1;
    if (user.hasAdminAccess === true) adminAccess += 1;
    if (
      user.role === Role.ADMIN &&
      memberKind === null &&
      user.hasStaffAccess === true &&
      user.hasAdminAccess === true
    ) {
      compatibilityOnlyAdminAuthorities += 1;
    }
  }
  for (const request of requests) requestStatuses[request.status] += 1;

  return {
    users: users.length,
    profiles,
    requests: requests.length,
    legacyRoles,
    memberKinds,
    selectedMemberKinds,
    unassignedMemberKinds,
    backfillTargets,
    requestStatuses,
    requestHistoryHash: requestHistoryHash(requests),
    staffAccess,
    adminAccess,
    compatibilityOnlyAdminAuthorities,
  };
}

function requestHistoryHash(
  requests: readonly MemberAuthorityRequestSnapshot[],
): string {
  const stable = [...requests]
    .sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    )
    .map(({ id, userId, status, decidedById }) => ({
      id,
      userId,
      status,
      decidedById,
    }));
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}
