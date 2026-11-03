import {
  userAuditRows,
  writeApprovalFixture,
  requestHistory,
} from './user-history.integration-fixture';
import {
  deferred,
  backendPid,
  pidCapturingPrisma,
  waitUntilBlockedBy,
} from './admin-actor-toctou.integration-support';
import { AdminRepository } from './admin.repository';
import { UserTransitionRepository } from './user-transition.repository';
import { StaffAccessRequestStatus } from './user-contract.config';
import { AdminAccessReadOrderingRepository } from './admin-access-read-ordering.repository';
import { AdminAccessReadRepository } from './admin-access-read.repository';
import { AdminAccessHistoryRepository } from './admin-access-history.repository';
import { canonicalUserCreateFromLabel } from './canonical-user-fixture';
import { AccountStatus } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import {
  ACCESS_AUDIT_ACTIONS,
  ACCESS_AUDIT_EVENT_KINDS,
} from '../platform/audit-log-metadata.config';
import { UserHistoryRepository } from './user-history.repository';
import { AuthRepository } from '../auth/auth.repository';
import { PrismaService } from '../platform/prisma.service';
import { RolesErrorCode } from './roles-error-code.error';
import { PausingRevocationAdminAccessRepository } from './admin-access.integration-support';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessService } from './admin-access.service';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { AdminAccessMutationService } from './admin-access-mutation.service';
import { UserProfileService } from './user-profile.service';
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const prisma = new PrismaService();
const repository = new AdminAccessRepository(
  prisma,
  new AdminAccessHistoryRepository(),
  new AdminAccessReadRepository(new AdminAccessReadOrderingRepository()),
  new AdminRepository(prisma),
  new UserTransitionRepository(),
);
const auditLog = new UserHistoryRepository(new UserTransitionRepository());
const service = new AdminAccessService(
  repository,
  auditLog,
  new AdminAccessMutationService(
    new AuditLogMetadataService(),
    new UserProfileService(),
  ),
);
const TEST_PREFIX = 'test:184:admin-access-revocation:';
const GITHUB_ID_BASE = 9001840000n;
let sequence = 0;
beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});
it('승인 이력이 있는 STAFF를 회수하면 역할이 비고 APPROVED 행은 그대로 남는다', async () => {
  const actor = await createUser('approved-actor', 'ADMIN');
  const target = await createUser('approved-target', 'STAFF');
  const approved = await writeApprovalFixture(prisma, {
    userId: target.id,
    status: 'APPROVED',
    decidedById: actor.id,
    decidedAt: new Date('2026-08-01T00:00:00Z'),
  });
  const imported = await prisma.userHistory.findMany({
    where: { userId: target.id, event: 'LEGACY_IMPORT' },
  });
  const result = await service.patchAccess(actor.githubId, target.id, {
    expectedRole: 'STAFF',
    desiredRole: null,
    expectedAccountStatus: AccountStatus.ACTIVE,
    desiredAccountStatus: AccountStatus.ACTIVE,
    expectedPendingRequest: null,
  });
  expect(result.role).toBeNull();
  expect(result.decidedRequest).toEqual({ id: approved.id, status: 'REVOKED' });
  await expect(
    prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
  ).resolves.toMatchObject({
    type: 'STAFF',
    approvalStatus: 'REVOKED',
    approvalRequestId: approved.id,
    accountStatus: 'ACTIVE',
  });
  await expect(
    prisma.userHistory.findMany({
      where: { userId: target.id, event: 'LEGACY_IMPORT' },
    }),
  ).resolves.toEqual(imported);
  const requests = await requestHistory(prisma, target.id);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    id: approved.id,
    status: 'REVOKED',
    decidedById: actor.id,
    rejectionReason: null,
  });
  expect(requests[0]?.decidedAt).not.toBeNull();
});
it('신청 없이 직접 부여된 STAFF도 회수하면 REVOKED 행이 생긴다', async () => {
  const actor = await createUser('direct-actor', 'ADMIN');
  const target = await createUser('direct-target', 'STAFF');
  await expect(requestHistory(prisma, target.id)).resolves.toEqual([]);
  const result = await service.patchAccess(actor.githubId, target.id, {
    expectedRole: 'STAFF',
    desiredRole: null,
    expectedAccountStatus: 'ACTIVE',
    desiredAccountStatus: 'ACTIVE',
    expectedPendingRequest: null,
  });
  expect(result).toMatchObject({
    role: null,
    decidedRequest: null,
    approvalStatus: 'REVOKED',
    approvalRequestId: null,
  });
  await expect(requestHistory(prisma, target.id)).resolves.toEqual([]);
  await expect(
    prisma.userHistory.count({
      where: { userId: target.id, event: 'REVOKED' },
    }),
  ).resolves.toBe(1);
});
it('신청 없는 회수는 USER를 대상으로 감사 기록을 남긴다', async () => {
  const actor = await createUser('audit-actor', 'ADMIN');
  const target = await createUser('audit-target', 'STAFF');
  const result = await service.patchAccess(actor.githubId, target.id, {
    expectedRole: 'STAFF',
    desiredRole: null,
    expectedAccountStatus: AccountStatus.ACTIVE,
    desiredAccountStatus: AccountStatus.ACTIVE,
    expectedPendingRequest: null,
  });
  expect(result.decidedRequest).toBeNull();
  const revokedRequestId = target.id;
  const logs = await userAuditRows(prisma, { targetId: revokedRequestId });
  expect(logs).toHaveLength(1);
  expect(logs[0]).toMatchObject({
    action: ACCESS_AUDIT_ACTIONS.ROLE_REQUEST_REVOKED,
    targetType: 'USER',
    metadata: {
      eventKind: ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_REVOKED,
      before: {
        role: 'STAFF',
        accountStatus: AccountStatus.ACTIVE,
        requestStatus: null,
      },
      after: {
        role: null,
        accountStatus: AccountStatus.ACTIVE,
        requestStatus: null,
      },
    },
  });
});
it.each<[string, 'ADMIN' | 'STUDENT']>([
  ['ADMIN', 'ADMIN'],
  ['STUDENT', 'STUDENT'],
])('%s는 여전히 역할을 비울 수 없다', async (label, role) => {
  const actor = await createUser(`not-allowed-actor-${label}`, 'ADMIN');
  const target = await createUser(`not-allowed-target-${label}`, role);
  await expect(
    service.patchAccess(actor.githubId, target.id, {
      expectedRole: role,
      desiredRole: null,
      expectedAccountStatus: AccountStatus.ACTIVE,
      desiredAccountStatus: AccountStatus.ACTIVE,
      expectedPendingRequest: null,
    }),
  ).rejects.toMatchObject({
    errorCode: {
      code: RolesErrorCode.ACCESS_TRANSITION_NOT_ALLOWED,
      status: 409,
    },
  });
  await expect(
    prisma.user.findUniqueOrThrow({
      include: { admin: true },
      where: { id: target.id },
    }),
  ).resolves.toMatchObject(
    role === 'ADMIN'
      ? { admin: { userId: target.id }, approvalStatus: 'NOT_REQUIRED' }
      : { admin: null, type: 'STUDENT', approvalStatus: 'NOT_REQUIRED' },
  );
  await expect(
    requestHistory(prisma, target.id).then((rows) => rows.length),
  ).resolves.toBe(0);
});
it('두 관리자가 동시에 회수하면 한쪽만 성공하고 REVOKED 행도 하나만 남는다', async () => {
  const firstActor = await createUser('race-actor-a', 'ADMIN');
  const secondActor = await createUser('race-actor-b', 'ADMIN');
  const target = await createUser('race-target', 'STAFF');
  const command = {
    expectedRole: 'STAFF',
    desiredRole: null,
    expectedAccountStatus: AccountStatus.ACTIVE,
    desiredAccountStatus: AccountStatus.ACTIVE,
    expectedPendingRequest: null,
  } as const;
  const outcomes = await Promise.allSettled([
    service.patchAccess(firstActor.githubId, target.id, command),
    service.patchAccess(secondActor.githubId, target.id, command),
  ]);
  const fulfilled = outcomes.filter(
    (outcome) => outcome.status === 'fulfilled',
  );
  const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  expect(rejected[0]).toMatchObject({
    reason: {
      errorCode: { code: RolesErrorCode.ACCESS_STATE_MISMATCH, status: 409 },
    },
  });
  await expect(requestHistory(prisma, target.id)).resolves.toEqual([]);
  await expect(
    prisma.userHistory.count({
      where: { userId: target.id, event: 'REVOKED' },
    }),
  ).resolves.toBe(1);
});
it('REVOKED 행 삽입 직후 실패하면 역할 CAS까지 함께 되돌아간다', async () => {
  const actor = await createUser('rollback-insert-actor', 'ADMIN');
  const target = await createUser('rollback-insert-target', 'STAFF');
  const failingService = new AdminAccessService(
    new PausingRevocationAdminAccessRepository(repository, () =>
      Promise.reject(new Error('synthetic-revocation-failure')),
    ),
    auditLog,
    new AdminAccessMutationService(
      new AuditLogMetadataService(),
      new UserProfileService(),
    ),
  );
  await expect(
    failingService.patchAccess(actor.githubId, target.id, {
      expectedRole: 'STAFF',
      desiredRole: null,
      expectedAccountStatus: AccountStatus.ACTIVE,
      desiredAccountStatus: AccountStatus.ACTIVE,
      expectedPendingRequest: null,
    }),
  ).rejects.toThrow('synthetic-revocation-failure');
  await expect(
    prisma.user.findUniqueOrThrow({
      include: { admin: true },
      where: { id: target.id },
    }),
  ).resolves.toMatchObject({
    approvalStatus: 'APPROVED',
    admin: null,
    accountStatus: AccountStatus.ACTIVE,
  });
  await expect(
    requestHistory(prisma, target.id).then((rows) => rows.length),
  ).resolves.toBe(0);
});
it('감사 기록이 실패하면 역할 CAS와 REVOKED 행이 함께 되돌아간다', async () => {
  const actor = await createUser('rollback-audit-actor', 'ADMIN');
  const target = await createUser('rollback-audit-target', 'STAFF');
  const failingAudit = new UserHistoryRepository(
    new UserTransitionRepository(),
  );
  jest
    .spyOn(failingAudit, 'record')
    .mockRejectedValue(new Error('synthetic-audit-failure'));
  const failingService = new AdminAccessService(
    repository,
    failingAudit,
    new AdminAccessMutationService(
      new AuditLogMetadataService(),
      new UserProfileService(),
    ),
  );
  await expect(
    failingService.patchAccess(actor.githubId, target.id, {
      expectedRole: 'STAFF',
      desiredRole: null,
      expectedAccountStatus: AccountStatus.ACTIVE,
      desiredAccountStatus: AccountStatus.ACTIVE,
      expectedPendingRequest: null,
    }),
  ).rejects.toThrow('synthetic-audit-failure');
  await expect(
    prisma.user.findUniqueOrThrow({
      include: { admin: true },
      where: { id: target.id },
    }),
  ).resolves.toMatchObject({
    approvalStatus: 'APPROVED',
    admin: null,
    accountStatus: AccountStatus.ACTIVE,
  });
  await expect(
    requestHistory(prisma, target.id).then((rows) => rows.length),
  ).resolves.toBe(0);
});
it('회수가 커밋되기 직전에 로그인이 끼어들어도 시드가 권한을 되살리지 못한다', async () => {
  const actor = await createUser('login-race-actor', 'ADMIN');
  const target = await createUser('login-race-target', 'STAFF');
  const approved = await writeApprovalFixture(prisma, {
    userId: target.id,
    status: StaffAccessRequestStatus.APPROVED,
    decidedById: actor.id,
    decidedAt: new Date('2026-08-01T00:00:00.000Z'),
  });
  const revocationBackend = backendPid();
  const loginBackend = backendPid();
  const authRepository = new AuthRepository(
    pidCapturingPrisma(prisma, loginBackend.capture),
  );
  const reachedCommitBoundary = deferred();
  const releaseRevocation = deferred();
  const pausedService = new AdminAccessService(
    new PausingRevocationAdminAccessRepository(
      new AdminAccessRepository(
        pidCapturingPrisma(prisma, revocationBackend.capture),
        new AdminAccessHistoryRepository(),
        new AdminAccessReadRepository(new AdminAccessReadOrderingRepository()),
        new AdminRepository(
          pidCapturingPrisma(prisma, revocationBackend.capture),
        ),
        new UserTransitionRepository(),
      ),
      async () => {
        reachedCommitBoundary.resolve();
        await releaseRevocation.promise;
      },
    ),
    auditLog,
    new AdminAccessMutationService(
      new AuditLogMetadataService(),
      new UserProfileService(),
    ),
  );
  const revocation = pausedService.patchAccess(actor.githubId, target.id, {
    expectedRole: 'STAFF',
    desiredRole: null,
    expectedAccountStatus: AccountStatus.ACTIVE,
    desiredAccountStatus: AccountStatus.ACTIVE,
    expectedPendingRequest: null,
  });
  await reachedCommitBoundary.promise;
  const login = authRepository.withTransaction((store) =>
    store.upsertUser({
      githubId: target.githubId,
      login: 'synthetic-login-race',
      name: null,
      avatarUrl: null,
      email: null,
    }),
  );
  await waitUntilBlockedBy(prisma, {
    waiterPid: await loginBackend.pid,
    blockerPid: await revocationBackend.pid,
  });
  releaseRevocation.resolve();
  const [revoked, loggedIn] = await Promise.all([revocation, login]);
  expect(revoked.role).toBeNull();
  expect(loggedIn.user.approvalStatus).toBe('REVOKED');
  const persisted = await prisma.user.findUniqueOrThrow({
    include: { admin: true },
    where: { id: target.id },
  });
  expect(
    persisted.type === 'STAFF' &&
      persisted.approvalStatus === 'APPROVED' &&
      persisted.profileCreatedAt !== null,
  ).toBe(false);
  const requests = await requestHistory(prisma, target.id);
  expect(requests).toHaveLength(1);
  expect(requests.map((request) => request.status)).toEqual(['REVOKED']);
  expect(requests[0]?.id).toBe(approved.id);
  expect(requests[0]?.decidedById).toBe(actor.id);
});
function createUser(label: string, role: 'STUDENT' | 'STAFF' | 'ADMIN' | null) {
  sequence += 1;
  return prisma.user.create({
    data: canonicalUserCreateFromLabel(role, {
      id: `${TEST_PREFIX}${label}:${sequence}`,
      githubId: GITHUB_ID_BASE + BigInt(sequence),
      nickname: `synthetic-184-${label}-${sequence}`,
      accountStatus: AccountStatus.ACTIVE,
    }),
    select: { id: true, githubId: true },
  });
}
