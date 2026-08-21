import { AccountStatus, MemberKind, Role } from '@prisma/client';
import type { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AdminAccessActor } from './admin-access.repository.types';
import {
  ADMIN_ACCESS_COMMANDS,
  STAFF_ACCESS_COMMANDS,
} from './domain/independent-authority';
import type {
  IndependentAuthorityRepositoryPort,
  IndependentAuthorityTransactionStore,
  IndependentAuthorityUserRecord,
} from './independent-authority.repository';
import { IndependentAuthorityService } from './independent-authority.service';
import type { IndependentAuthorityTransition } from './independent-authority-transition';

const actorGithubId = 9_700_600_001n;

class AuditAuthorityStore
  implements
    IndependentAuthorityRepositoryPort,
    IndependentAuthorityTransactionStore
{
  readonly auditLogWriter = new PrismaService();
  target = targetUser();
  activeAdminCount = 2;
  events: string[] = [];
  updates: IndependentAuthorityTransition[] = [];
  updateError: Error | null = null;
  rolledBack = false;

  async withTransaction<T>(
    operation: (store: IndependentAuthorityTransactionStore) => Promise<T>,
  ): Promise<T> {
    const updatesBefore = [...this.updates];
    try {
      return await operation(this);
    } catch (error) {
      this.updates = updatesBefore;
      this.rolledBack = true;
      throw error;
    }
  }

  findActorByGithubId(): Promise<AdminAccessActor> {
    this.events.push('actor');
    return Promise.resolve({
      id: 'actor',
      githubId: actorGithubId,
      githubLogin: 'synthetic-admin',
      name: '합성 관리자',
      role: Role.ADMIN,
      accountStatus: AccountStatus.ACTIVE,
    });
  }

  lockActiveAdmins(): Promise<number> {
    this.events.push('lock');
    return Promise.resolve(this.activeAdminCount);
  }

  findUserForUpdate(): Promise<IndependentAuthorityUserRecord> {
    this.events.push('target');
    return Promise.resolve(this.target);
  }

  updateAuthority(
    _userId: string,
    transition: IndependentAuthorityTransition,
  ): Promise<void> {
    this.events.push('update');
    if (this.updateError) {
      return Promise.reject(this.updateError);
    }
    this.updates.push(transition);
    return Promise.resolve();
  }
}

it.each([
  ['staff', STAFF_ACCESS_COMMANDS.GRANT, Role.STAFF, true, false],
  ['admin', ADMIN_ACCESS_COMMANDS.GRANT, Role.ADMIN, false, true],
] as const)(
  '%s mutation writes one audit with the transaction writer',
  async (family, command, role, hasStaffAccess, hasAdminAccess) => {
    const store = new AuditAuthorityStore();
    const record = jest
      .fn<
        ReturnType<AuditLogService['record']>,
        Parameters<AuditLogService['record']>
      >()
      .mockImplementation((input) => {
        store.events.push('audit');
        return Promise.resolve({
          id: 'synthetic-audit',
          actor: 'synthetic-admin',
          actorHandle: 'synthetic-admin',
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId ?? 'target',
          target: 'synthetic-target',
          targetHandle: 'synthetic-target',
          occurredAt: new Date(0),
          legacy: true,
          metadata: null,
        });
      });
    const auditLog = { record } satisfies Pick<AuditLogService, 'record'>;
    const service = new IndependentAuthorityService(store, auditLog);

    if (family === 'staff') {
      await service.patchStaffAccess(actorGithubId, 'target', { command });
    } else {
      await service.patchAdminAccess(actorGithubId, 'target', { command });
    }

    expect(store.updates).toHaveLength(1);
    expect(store.events).toEqual([
      'lock',
      'actor',
      'target',
      'update',
      'audit',
    ]);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]?.[1]).toBe(store.auditLogWriter);
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      actorGithubId,
      action: command,
      targetType: 'USER',
      targetId: 'target',
      metadata: {
        command,
        actor: { githubLogin: 'synthetic-admin' },
        target: { githubLogin: 'synthetic-target' },
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

it('does not write a phantom audit for an idempotent same-state command', async () => {
  const store = new AuditAuthorityStore();
  store.target = targetUser({ role: Role.ADMIN, hasAdminAccess: true });
  const record = jest.fn();
  const service = new IndependentAuthorityService(store, { record });

  await service.patchAdminAccess(actorGithubId, 'target', {
    command: ADMIN_ACCESS_COMMANDS.GRANT,
  });

  expect(store.updates).toHaveLength(0);
  expect(record).not.toHaveBeenCalled();
});

it('propagates audit failure so the authority transaction rolls back', async () => {
  const store = new AuditAuthorityStore();
  const auditFailure = new Error('synthetic audit failure');
  const service = new IndependentAuthorityService(store, {
    record: jest.fn().mockRejectedValue(auditFailure),
  });

  await expect(
    service.patchStaffAccess(actorGithubId, 'target', {
      command: STAFF_ACCESS_COMMANDS.GRANT,
    }),
  ).rejects.toBe(auditFailure);
  expect(store.updates).toHaveLength(0);
  expect(store.events).toContain('update');
  expect(store.rolledBack).toBe(true);
});

it('does not update or audit when the final-admin guard fails', async () => {
  const store = new AuditAuthorityStore();
  store.activeAdminCount = 1;
  store.target = targetUser({ role: Role.ADMIN, hasAdminAccess: true });
  const record = jest.fn();
  const service = new IndependentAuthorityService(store, { record });

  await expect(
    service.patchAdminAccess(actorGithubId, 'target', {
      command: ADMIN_ACCESS_COMMANDS.REVOKE,
    }),
  ).rejects.toMatchObject({ errorCode: { code: 'ROL_018', status: 409 } });
  expect(store.updates).toHaveLength(0);
  expect(record).not.toHaveBeenCalled();
  expect(store.rolledBack).toBe(true);
});

it('does not audit when the authority update fails', async () => {
  const store = new AuditAuthorityStore();
  const updateFailure = new Error('synthetic update failure');
  store.updateError = updateFailure;
  const record = jest.fn();
  const service = new IndependentAuthorityService(store, { record });

  await expect(
    service.patchAdminAccess(actorGithubId, 'target', {
      command: ADMIN_ACCESS_COMMANDS.GRANT,
    }),
  ).rejects.toBe(updateFailure);
  expect(record).not.toHaveBeenCalled();
  expect(store.rolledBack).toBe(true);
});

function targetUser(
  overrides: Partial<IndependentAuthorityUserRecord> = {},
): IndependentAuthorityUserRecord {
  return {
    id: 'target',
    githubId: 9_700_600_002n,
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
    ...overrides,
  };
}
