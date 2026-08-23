import { AccountStatus, MemberKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RolesErrorCode } from '../roles/roles-error-code.enum';
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

const actorGithubId = 9_700_100_001n;

class AuthorityStore
  implements
    IndependentAuthorityRepositoryPort,
    IndependentAuthorityTransactionStore
{
  readonly auditLogWriter = new PrismaService();
  actor: AdminAccessActor | null = {
    id: 'actor',
    githubId: actorGithubId,
    githubLogin: 'synthetic-admin',
    hasAdminAccess: true,
    hasStaffAccess: true,
    accountStatus: AccountStatus.ACTIVE,
  };
  target: IndependentAuthorityUserRecord | null = target();
  activeAdminCount = 2;
  updates: IndependentAuthorityTransition[] = [];

  withTransaction<T>(
    operation: (store: IndependentAuthorityTransactionStore) => Promise<T>,
  ): Promise<T> {
    return operation(this);
  }

  findActorByGithubId(): Promise<AdminAccessActor | null> {
    return Promise.resolve(this.actor);
  }

  lockActiveAdmins(): Promise<number> {
    return Promise.resolve(this.activeAdminCount);
  }

  findUserForUpdate(): Promise<IndependentAuthorityUserRecord | null> {
    return Promise.resolve(this.target);
  }

  updateAuthority(
    _userId: string,
    transition: IndependentAuthorityTransition,
  ): Promise<void> {
    this.updates.push(transition);
    return Promise.resolve();
  }
}

it.each([
  [STAFF_ACCESS_COMMANDS.REVOKE, false, true],
  [ADMIN_ACCESS_COMMANDS.REVOKE, true, false],
] as const)(
  '%s toggles only its target authority',
  async (command, hasStaffAccess, hasAdminAccess) => {
    const store = new AuthorityStore();
    store.target = target({ hasStaffAccess: true, hasAdminAccess: true });
    const service = new IndependentAuthorityService(store, noopAuditLog());

    const result =
      command === STAFF_ACCESS_COMMANDS.REVOKE
        ? await service.patchStaffAccess(actorGithubId, 'target', { command })
        : await service.patchAdminAccess(actorGithubId, 'target', { command });

    expect(result).toMatchObject({
      memberKind: MemberKind.STUDENT,
      hasStaffAccess,
      hasAdminAccess,
    });
    expect(store.updates).toHaveLength(1);
  },
);

it('treats a same-state grant as an idempotent success without writing', async () => {
  const store = new AuthorityStore();
  store.target = target({ hasAdminAccess: true, role: 'ADMIN' });
  const service = new IndependentAuthorityService(store, noopAuditLog());

  await expect(
    service.patchAdminAccess(actorGithubId, 'target', {
      command: ADMIN_ACCESS_COMMANDS.GRANT,
    }),
  ).resolves.toMatchObject({ hasAdminAccess: true, hasStaffAccess: false });
  expect(store.updates).toHaveLength(0);
});

it('rejects a non-admin actor before writing', async () => {
  const store = new AuthorityStore();
  store.actor = {
    id: 'staff-actor',
    githubId: actorGithubId,
    githubLogin: 'synthetic-staff',
    role: 'STAFF',
    hasAdminAccess: false,
    accountStatus: AccountStatus.ACTIVE,
  };
  const service = new IndependentAuthorityService(store, noopAuditLog());

  await expect(
    service.patchStaffAccess(actorGithubId, 'target', {
      command: STAFF_ACCESS_COMMANDS.GRANT,
    }),
  ).rejects.toMatchObject({
    errorCode: { code: RolesErrorCode.ADMIN_ONLY, status: 403 },
  });
  expect(store.updates).toHaveLength(0);
});

it('rejects revoking the final active admin', async () => {
  const store = new AuthorityStore();
  store.activeAdminCount = 1;
  store.target = target({ hasAdminAccess: true, role: 'ADMIN' });
  const service = new IndependentAuthorityService(store, noopAuditLog());

  await expect(
    service.patchAdminAccess(actorGithubId, 'target', {
      command: ADMIN_ACCESS_COMMANDS.REVOKE,
    }),
  ).rejects.toMatchObject({
    errorCode: { code: RolesErrorCode.LAST_ACTIVE_ADMIN_REQUIRED, status: 409 },
  });
  expect(store.updates).toHaveLength(0);
});

function noopAuditLog() {
  return { record: jest.fn().mockResolvedValue({}) };
}

function target(
  overrides: Partial<IndependentAuthorityUserRecord> = {},
): IndependentAuthorityUserRecord {
  return {
    id: 'target',
    githubId: 9_700_100_002n,
    githubLogin: 'synthetic-target',
    selectedMemberKind: MemberKind.STUDENT,
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
