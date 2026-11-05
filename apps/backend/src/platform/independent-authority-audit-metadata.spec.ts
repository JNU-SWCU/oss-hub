import { AccountStatus } from '@prisma/client';
import { MemberKind } from '../users/user-contract.config';
import type { IndependentAuthorityUserRecord } from '../users/independent-authority.repository';
import { INDEPENDENT_AUTHORITY_AUDIT_COMMANDS } from './history-metadata.config';
import {
  type IndependentAuthorityCommand,
  IndependentAuthorityService,
} from '../users/independent-authority.service';
import { HistoryMetadataService } from './history-metadata.service';
import { UserProfileService } from '../users/user-profile.service';
import { AdminAccessMutationService } from '../users/admin-access-mutation.service';

const independentAuthorityService = new IndependentAuthorityService(
  undefined as never,
  undefined as never,
  new HistoryMetadataService(),
  new AdminAccessMutationService(
    new HistoryMetadataService(),
    new UserProfileService(),
  ),
  new UserProfileService(),
);

const actorGithubId = 9_700_700_001n;

it.each([
  [
    INDEPENDENT_AUTHORITY_AUDIT_COMMANDS.GRANT_STAFF_ACCESS,
    true,
    false,
    'STAFF',
  ],
  [
    INDEPENDENT_AUTHORITY_AUDIT_COMMANDS.REVOKE_STAFF_ACCESS,
    false,
    false,
    'STUDENT',
  ],
  [
    INDEPENDENT_AUTHORITY_AUDIT_COMMANDS.GRANT_ADMIN_ACCESS,
    false,
    true,
    'ADMIN',
  ],
  [
    INDEPENDENT_AUTHORITY_AUDIT_COMMANDS.REVOKE_ADMIN_ACCESS,
    false,
    false,
    'STUDENT',
  ],
] as const)(
  'stores canonical command %s with every canonical state field',
  (command, hasStaffAccess, hasAdminAccess, role) => {
    const stored = createStoredMetadata(command, {
      hasStaffAccess,
      hasAdminAccess,
      role,
    });

    expect(storageRoundTrip(stored)).toEqual({
      schemaVersion: 2,
      eventKind: 'INDEPENDENT_AUTHORITY_CHANGED',
      command,
      actor: {
        displayName: '합성 관리자',
        githubLogin: 'synthetic-admin',
      },
      target: {
        displayName: '합성 학생',
        githubLogin: 'synthetic-target',
      },
      before: {
        memberKind: MemberKind.STUDENT,
        hasStaffAccess: false,
        hasAdminAccess: false,
        role: 'STUDENT',
        accountStatus: AccountStatus.ACTIVE,
      },
      after: {
        memberKind: MemberKind.STUDENT,
        hasStaffAccess,
        hasAdminAccess,
        role,
        accountStatus: AccountStatus.ACTIVE,
      },
    });
  },
);

function createStoredMetadata(
  command: IndependentAuthorityCommand['command'],
  after: Partial<IndependentAuthorityUserRecord>,
) {
  const before = targetUser();
  const audit = independentAuthorityService.createIndependentAuthorityAudit({
    actorGithubId,
    actor: {
      name: '합성 관리자',
      id: 'actor',
      githubId: actorGithubId,
      githubLogin: 'synthetic-admin',
      hasAdminAccess: true,
      accountStatus: AccountStatus.ACTIVE,
      memberKind: MemberKind.STAFF,
      approvalStatus: 'APPROVED',
      profileCreatedAt: new Date('2026-07-19T00:00:00.000Z'),
      department: 'Synthetic department',
    },
    before,
    after: { ...before, ...after },
    command: { command },
  });
  if (!audit.metadata) {
    throw new Error('synthetic authority audit metadata is required');
  }
  return audit.metadata;
}

function targetUser(): IndependentAuthorityUserRecord {
  return {
    id: 'target',
    githubId: 9_700_700_002n,
    githubLogin: 'synthetic-target',
    name: '합성 학생',
    role: 'STUDENT',
    selectedMemberKind: MemberKind.STUDENT,
    memberKind: MemberKind.STUDENT,
    approvalStatus: 'NOT_REQUIRED',
    approvalRequestId: null,
    hasStaffAccess: false,
    hasAdminAccess: false,
    accountStatus: AccountStatus.ACTIVE,
    isProfileComplete: true,
    createdAt: new Date('2026-07-19T00:00:00.000Z'),
    pendingRequest: null,
    lastLoginAt: null,
  };
}

function storageRoundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}
