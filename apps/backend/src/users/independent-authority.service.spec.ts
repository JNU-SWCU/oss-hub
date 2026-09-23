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
    name: null,
    role: 'ADMIN',
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
    name: null,
    hasStaffAccess: false,
    id: 'staff-actor',
    githubId: actorGithubId,
    githubLogin: 'synthetic-staff',
    role: 'STUDENT',
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

/**
 * #1382 — 자기 관리자 접근 회수는 성공하는 순간 호출자가 이 화면을 읽을 권한까지
 * 잃는다. 계정 상태 쪽 `ROL_017`과 같은 자리의 거절이며, 활성 관리자가 둘 이상이라
 * `ROL_018`이 걸리지 않는 상태에서만 이 가드가 답한다.
 */
it('rejects revoking the actor own admin access', async () => {
  const store = new AuthorityStore();
  store.activeAdminCount = 3;
  store.target = target({
    id: 'actor',
    hasAdminAccess: true,
    hasStaffAccess: true,
    role: 'ADMIN',
  });
  const service = new IndependentAuthorityService(store, noopAuditLog());

  await expect(
    service.patchAdminAccess(actorGithubId, 'actor', {
      command: ADMIN_ACCESS_COMMANDS.REVOKE,
    }),
  ).rejects.toMatchObject({
    errorCode: {
      code: RolesErrorCode.SELF_ADMIN_REVOKE_FORBIDDEN,
      status: 409,
    },
  });
  expect(store.updates).toHaveLength(0);
});

it('still allows the actor to revoke their own staff access', async () => {
  const store = new AuthorityStore();
  store.activeAdminCount = 3;
  store.target = target({
    id: 'actor',
    hasAdminAccess: true,
    hasStaffAccess: true,
    role: 'ADMIN',
  });
  const service = new IndependentAuthorityService(store, noopAuditLog());

  await expect(
    service.patchStaffAccess(actorGithubId, 'actor', {
      command: STAFF_ACCESS_COMMANDS.REVOKE,
    }),
  ).resolves.toMatchObject({ hasStaffAccess: false, hasAdminAccess: true });
  expect(store.updates).toHaveLength(1);
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
    name: null,
    role: 'STUDENT',
    selectedMemberKind: MemberKind.STUDENT,
    memberKind: MemberKind.STUDENT,
    hasStaffAccess: false,
    hasAdminAccess: false,
    accountStatus: AccountStatus.ACTIVE,
    isProfileComplete: true,
    createdAt: new Date('2026-07-19T00:00:00.000Z'),
    pendingRequest: null,
    lastLoginAt: null,
    ...overrides,
  };
}
