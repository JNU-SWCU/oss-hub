import { AccountStatus, MemberKind, Role } from '@prisma/client';
import {
  INDEPENDENT_AUTHORITY_AUDIT_COMMANDS,
  InvalidAuditLogMetadataError,
  parseAuditLogMetadata,
  type IndependentAuthorityAuditCommand,
} from './audit-log-metadata';
import { createIndependentAuthorityAudit } from '../users/independent-authority-audit';
import type { IndependentAuthorityUserRecord } from '../users/independent-authority.repository';

const actorGithubId = 9_700_700_001n;

it.each([
  [
    INDEPENDENT_AUTHORITY_AUDIT_COMMANDS.GRANT_STAFF_ACCESS,
    true,
    false,
    Role.STAFF,
  ],
  [
    INDEPENDENT_AUTHORITY_AUDIT_COMMANDS.REVOKE_STAFF_ACCESS,
    false,
    false,
    Role.STUDENT,
  ],
  [
    INDEPENDENT_AUTHORITY_AUDIT_COMMANDS.GRANT_ADMIN_ACCESS,
    false,
    true,
    Role.ADMIN,
  ],
  [
    INDEPENDENT_AUTHORITY_AUDIT_COMMANDS.REVOKE_ADMIN_ACCESS,
    false,
    false,
    Role.STUDENT,
  ],
] as const)(
  'round-trips canonical command %s through storage parser and view',
  (command, hasStaffAccess, hasAdminAccess, role) => {
    const stored = createStoredMetadata(command, {
      hasStaffAccess,
      hasAdminAccess,
      role,
      selectedRole: role,
    });

    expect(parseAuditLogMetadata(storageRoundTrip(stored))).toEqual({
      legacy: false,
      metadata: {
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
          role: Role.STUDENT,
          accountStatus: AccountStatus.ACTIVE,
        },
        after: {
          memberKind: MemberKind.STUDENT,
          hasStaffAccess,
          hasAdminAccess,
          role,
          accountStatus: AccountStatus.ACTIVE,
        },
      },
    });
  },
);

it.each([
  ['missing command', (metadata: MetadataFixture) => omit(metadata, 'command')],
  [
    'wrong command type',
    (metadata: MetadataFixture) => ({ ...metadata, command: 1 }),
  ],
  [
    'unknown command',
    (metadata: MetadataFixture) => ({ ...metadata, command: 'SET_ROLE_ADMIN' }),
  ],
  [
    'unknown event',
    (metadata: MetadataFixture) => ({
      ...metadata,
      eventKind: 'AUTHORITY_CHANGED',
    }),
  ],
  [
    'wrong state type',
    (metadata: MetadataFixture) => ({
      ...metadata,
      before: { ...metadata.before, hasStaffAccess: 'yes' },
    }),
  ],
  [
    'extra top-level field',
    (metadata: MetadataFixture) => ({ ...metadata, secret: true }),
  ],
  [
    'extra snapshot field',
    (metadata: MetadataFixture) => ({
      ...metadata,
      actor: { ...metadata.actor, id: 'actor' },
    }),
  ],
  [
    'extra state field',
    (metadata: MetadataFixture) => ({
      ...metadata,
      after: { ...metadata.after, requestStatus: null },
    }),
  ],
] as const)('fails closed for %s', (_name, mutate) => {
  const valid = createStoredMetadata(
    INDEPENDENT_AUTHORITY_AUDIT_COMMANDS.GRANT_STAFF_ACCESS,
    {
      hasStaffAccess: true,
      role: Role.STAFF,
      selectedRole: Role.STAFF,
    },
  );

  expect(() => parseAuditLogMetadata(mutate(valid))).toThrow(
    InvalidAuditLogMetadataError,
  );
});

type MetadataFixture = ReturnType<typeof createStoredMetadata>;

function createStoredMetadata(
  command: IndependentAuthorityAuditCommand,
  after: Partial<IndependentAuthorityUserRecord>,
) {
  const before = targetUser();
  const audit = createIndependentAuthorityAudit({
    actorGithubId,
    actor: {
      id: 'actor',
      githubId: actorGithubId,
      githubLogin: 'synthetic-admin',
      name: '합성 관리자',
      role: Role.ADMIN,
      accountStatus: AccountStatus.ACTIVE,
      hasStaffAccess: true,
      hasAdminAccess: true,
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
    role: Role.STUDENT,
    selectedRole: Role.STUDENT,
    memberKind: MemberKind.STUDENT,
    hasStaffAccess: false,
    hasAdminAccess: false,
    accountStatus: AccountStatus.ACTIVE,
    isProfileComplete: true,
    pendingRequest: null,
    lastLoginAt: null,
  };
}

function storageRoundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function omit<Value extends Record<string, unknown>, Key extends keyof Value>(
  value: Value,
  key: Key,
): Omit<Value, Key> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}
