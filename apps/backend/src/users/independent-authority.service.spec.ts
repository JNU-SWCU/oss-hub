import { AccountStatus, MemberKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RolesErrorCode } from '../roles/roles-error-code.enum';
import type {
  AdminAccessActor,
  AdminAccessInsertedRequest,
  AdminAccessRevokedRequestInsert,
} from './admin-access.repository.types';
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
  revokedInserts: AdminAccessRevokedRequestInsert[] = [];

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

  insertRevokedRequest(
    input: AdminAccessRevokedRequestInsert,
  ): Promise<AdminAccessInsertedRequest> {
    this.revokedInserts.push(input);
    return Promise.resolve({ id: `revoked-${this.revokedInserts.length}` });
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

/**
 * #1411 — 이미 그 상태인 명령은 보낸 쪽이 본 값이 낡았다는 뜻이다. 예전에는 아무것도
 * 쓰지 않고 성공으로 답해 화면이 「처리를 완료했습니다」라고 말했다. 레거시 CAS 와
 * 같은 409 `ROL_013` 과 현재 접근 상태로 거절하고, 여전히 아무것도 쓰지 않는다.
 */
it.each([
  [
    '이미 켜진 관리자 접근에 다시 보낸 부여',
    ADMIN_ACCESS_COMMANDS.GRANT,
    target({ hasAdminAccess: true, role: 'ADMIN' }),
  ],
  [
    '이미 꺼진 교직원 접근에 다시 보낸 회수',
    STAFF_ACCESS_COMMANDS.REVOKE,
    target({ hasStaffAccess: false }),
  ],
] as const)(
  '%s는 409 ROL_013 으로 거절하고 아무것도 쓰지 않는다',
  async (_label, command, before) => {
    const store = new AuthorityStore();
    store.target = before;
    const service = new IndependentAuthorityService(store, noopAuditLog());

    const request =
      command === ADMIN_ACCESS_COMMANDS.GRANT
        ? service.patchAdminAccess(actorGithubId, 'target', { command })
        : service.patchStaffAccess(actorGithubId, 'target', { command });

    await expect(request).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ACCESS_STATE_MISMATCH, status: 409 },
      extensions: { currentAccess: { id: before.id, role: before.role } },
    });
    expect(store.updates).toHaveLength(0);
    expect(store.revokedInserts).toEqual([]);
  },
);

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

it('교직원 접근을 회수하면 행위자와 시각이 적힌 회수 이력 한 행을 남긴다', async () => {
  const store = new AuthorityStore();
  store.target = target({ hasStaffAccess: true, role: 'STAFF' });
  const service = new IndependentAuthorityService(store, noopAuditLog());

  await service.patchStaffAccess(actorGithubId, 'target', {
    command: STAFF_ACCESS_COMMANDS.REVOKE,
  });

  expect(store.revokedInserts).toHaveLength(1);
  expect(store.revokedInserts[0]).toMatchObject({
    userId: 'target',
    actorId: 'actor',
  });
  expect(store.revokedInserts[0]?.decidedAt).toBeInstanceOf(Date);
});

it.each([
  ['교직원 접근을 켜는 전이', STAFF_ACCESS_COMMANDS.GRANT, target({})],
  [
    '관리자 접근을 끄는 전이',
    ADMIN_ACCESS_COMMANDS.REVOKE,
    target({ hasStaffAccess: true, hasAdminAccess: true, role: 'ADMIN' }),
  ],
] as const)(
  '%s는 교직원 신청 표를 건드리지 않는다',
  async (_label, command, before) => {
    const store = new AuthorityStore();
    store.target = before;
    const service = new IndependentAuthorityService(store, noopAuditLog());

    if (command === ADMIN_ACCESS_COMMANDS.REVOKE) {
      await service.patchAdminAccess(actorGithubId, 'target', { command });
    } else {
      await service.patchStaffAccess(actorGithubId, 'target', { command });
    }

    expect(store.updates).toHaveLength(1);
    expect(store.revokedInserts).toEqual([]);
  },
);

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
