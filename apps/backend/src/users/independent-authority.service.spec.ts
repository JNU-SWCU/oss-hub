import { MemberKind } from './user-contract.config';
import { AccountStatus } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { RolesErrorCode } from './roles-error-code.error';
import {
  type IndependentAuthorityRepositoryPort,
  type IndependentAuthorityTransactionStore,
  type IndependentAuthorityTransition,
} from './independent-authority.repository';
import {
  STAFF_ACCESS_COMMANDS,
  ADMIN_ACCESS_COMMANDS,
} from './admin-access-query.config';
import { IndependentAuthorityService } from './independent-authority.service';
import {
  type AdminAccessActor,
  type AdminAccessInsertedRequest,
  type AdminAccessRevokedRequestInsert,
} from './admin-access-read.repository';
import { HistoryMetadataService } from '../platform/history-metadata.service';
import { UserProfileService } from './user-profile.service';
import { AdminAccessMutationService } from './admin-access-mutation.service';
import type { AdminAccessUserRow } from './admin-access-read.repository';
const actorGithubId = 9700100001n;
class AuthorityStore
  implements
    IndependentAuthorityRepositoryPort,
    IndependentAuthorityTransactionStore
{
  readonly auditLogWriter = new PrismaService();
  actor: AdminAccessActor | null = {
    name: null,
    id: 'actor',
    githubId: actorGithubId,
    githubLogin: 'synthetic-admin',
    hasAdminAccess: true,
    memberKind: 'STAFF',
    approvalStatus: 'APPROVED',
    profileCreatedAt: new Date('2026-01-01'),
    department: 'Department',
    accountStatus: AccountStatus.ACTIVE,
  };
  target: AdminAccessUserRow | null = target();
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
  findUserForUpdate(): Promise<AdminAccessUserRow | null> {
    return Promise.resolve(this.target);
  }
  updateAuthority(
    _userId: string,
    transition: IndependentAuthorityTransition,
  ): Promise<{
    approvalStatus: AdminAccessUserRow['approvalStatus'];
    approvalRequestId: string | null;
  }> {
    this.updates.push(transition);
    if (!this.target) throw new TypeError('Missing target');
    return Promise.resolve({
      approvalStatus: this.target.approvalStatus,
      approvalRequestId: this.target.approvalRequestId,
    });
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
    const service = new IndependentAuthorityService(
      store,
      noopAuditLog(),
      new HistoryMetadataService(),
      new AdminAccessMutationService(
        new HistoryMetadataService(),
        new UserProfileService(),
      ),
      new UserProfileService(),
    );
    const result =
      command === STAFF_ACCESS_COMMANDS.REVOKE
        ? await service.patchStaffAccess(actorGithubId, 'target', { command })
        : await service.patchAdminAccess(actorGithubId, 'target', { command });
    expect(result).toMatchObject({
      memberKind: MemberKind.STAFF,
      hasStaffAccess,
      hasAdminAccess,
    });
    expect(store.updates).toHaveLength(1);
  },
);
it.each([
  [
    '이미 켜진 관리자 접근에 다시 보낸 부여',
    ADMIN_ACCESS_COMMANDS.GRANT,
    target({ hasAdminAccess: true }),
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
    const service = new IndependentAuthorityService(
      store,
      noopAuditLog(),
      new HistoryMetadataService(),
      new AdminAccessMutationService(
        new HistoryMetadataService(),
        new UserProfileService(),
      ),
      new UserProfileService(),
    );
    const request =
      command === ADMIN_ACCESS_COMMANDS.GRANT
        ? service.patchAdminAccess(actorGithubId, 'target', { command })
        : service.patchStaffAccess(actorGithubId, 'target', { command });
    await expect(request).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ACCESS_STATE_MISMATCH, status: 409 },
      extensions: { currentAccess: { id: before.id } },
    });
    expect(store.updates).toHaveLength(0);
    expect(store.revokedInserts).toEqual([]);
  },
);
it('rejects a non-admin actor before writing', async () => {
  const store = new AuthorityStore();
  store.actor = {
    name: null,
    memberKind: 'STAFF',
    approvalStatus: 'REVOKED',
    profileCreatedAt: new Date('2026-01-01'),
    department: 'Department',
    id: 'staff-actor',
    githubId: actorGithubId,
    githubLogin: 'synthetic-staff',
    hasAdminAccess: false,
    accountStatus: AccountStatus.ACTIVE,
  };
  const service = new IndependentAuthorityService(
    store,
    noopAuditLog(),
    new HistoryMetadataService(),
    new AdminAccessMutationService(
      new HistoryMetadataService(),
      new UserProfileService(),
    ),
    new UserProfileService(),
  );
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
  store.target = target({ hasAdminAccess: true });
  const service = new IndependentAuthorityService(
    store,
    noopAuditLog(),
    new HistoryMetadataService(),
    new AdminAccessMutationService(
      new HistoryMetadataService(),
      new UserProfileService(),
    ),
    new UserProfileService(),
  );
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
  store.target = target({ hasStaffAccess: true });
  const service = new IndependentAuthorityService(
    store,
    noopAuditLog(),
    new HistoryMetadataService(),
    new AdminAccessMutationService(
      new HistoryMetadataService(),
      new UserProfileService(),
    ),
    new UserProfileService(),
  );
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
    target({ hasStaffAccess: true, hasAdminAccess: true }),
  ],
] as const)(
  '%s는 교직원 신청 표를 건드리지 않는다',
  async (_label, command, before) => {
    const store = new AuthorityStore();
    store.target = before;
    const service = new IndependentAuthorityService(
      store,
      noopAuditLog(),
      new HistoryMetadataService(),
      new AdminAccessMutationService(
        new HistoryMetadataService(),
        new UserProfileService(),
      ),
      new UserProfileService(),
    );
    if (command === ADMIN_ACCESS_COMMANDS.REVOKE) {
      await service.patchAdminAccess(actorGithubId, 'target', { command });
    } else {
      await service.patchStaffAccess(actorGithubId, 'target', { command });
    }
    expect(store.updates).toHaveLength(1);
    expect(store.revokedInserts).toEqual([]);
  },
);
it('rejects revoking the actor own admin access', async () => {
  const store = new AuthorityStore();
  store.activeAdminCount = 3;
  store.target = target({
    id: 'actor',
    hasAdminAccess: true,
    hasStaffAccess: true,
  });
  const service = new IndependentAuthorityService(
    store,
    noopAuditLog(),
    new HistoryMetadataService(),
    new AdminAccessMutationService(
      new HistoryMetadataService(),
      new UserProfileService(),
    ),
    new UserProfileService(),
  );
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
  });
  const service = new IndependentAuthorityService(
    store,
    noopAuditLog(),
    new HistoryMetadataService(),
    new AdminAccessMutationService(
      new HistoryMetadataService(),
      new UserProfileService(),
    ),
    new UserProfileService(),
  );
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
  overrides: Partial<AdminAccessUserRow> & {
    readonly hasStaffAccess?: boolean;
  } = {},
): AdminAccessUserRow {
  const { hasStaffAccess = false, ...raw } = overrides;
  return {
    id: 'target',
    githubId: 9700100002n,
    githubLogin: 'synthetic-target',
    name: 'Target',
    studentId: null,
    department: 'Department',
    selectedMemberKind: 'STAFF',
    memberKind: 'STAFF',
    approvalStatus: hasStaffAccess ? 'APPROVED' : 'REVOKED',
    approvalRequestId: null,
    profileCreatedAt: new Date('2026-01-01'),
    hasAdminAccess: false,
    accountStatus: 'ACTIVE',
    createdAt: new Date('2026-01-01'),
    pendingRequest: null,
    lastLoginAt: null,
    ...raw,
  };
}
