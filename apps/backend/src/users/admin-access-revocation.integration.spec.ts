import { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import {
  ACCESS_AUDIT_ACTIONS,
  ACCESS_AUDIT_EVENT_KINDS,
} from '../audit-log/audit-log-metadata';
import { AuditLogRepository } from '../audit-log/audit-log.repository';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthConfig } from '../auth/auth.config';
import { AuthRepository } from '../auth/auth.repository';
import { PrismaService } from '../prisma/prisma.service';
import { RolesErrorCode } from '../roles/roles-error-code.enum';
import { PausingRevocationAdminAccessRepository } from './admin-access.integration-support';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessService } from './admin-access.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const repository = new AdminAccessRepository(prisma);
const auditLog = new AuditLogService(new AuditLogRepository(prisma));
const service = new AdminAccessService(repository, auditLog);
const TEST_PREFIX = 'test:184:admin-access-revocation:';
const GITHUB_ID_BASE = 9_001_840_000n;
let sequence = 0;

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

it('승인 이력이 있는 STAFF를 회수하면 역할이 비고 APPROVED 행은 그대로 남는다', async () => {
  // Given
  const actor = await createUser('approved-actor', Role.ADMIN);
  const target = await createUser('approved-target', Role.STAFF);
  const approved = await prisma.roleRequest.create({
    data: {
      userId: target.id,
      status: RoleRequestStatus.APPROVED,
      decidedById: actor.id,
      decidedAt: new Date('2026-08-01T00:00:00.000Z'),
    },
  });

  // When
  const result = await service.patchAccess(actor.githubId, target.id, {
    expectedRole: Role.STAFF,
    desiredRole: null,
    expectedAccountStatus: AccountStatus.ACTIVE,
    desiredAccountStatus: AccountStatus.ACTIVE,
    expectedPendingRequest: null,
  });

  // Then
  expect(result.role).toBeNull();
  expect(result.decidedRequest?.status).toBe(RoleRequestStatus.REVOKED);
  expect(result.decidedRequest?.id).not.toBe(approved.id);
  const persisted = await prisma.user.findUniqueOrThrow({
    where: { id: target.id },
  });
  expect(persisted.role).toBeNull();
  expect(persisted.accountStatus).toBe(AccountStatus.ACTIVE);

  // 승인 이력은 장학금 근거라 회수가 덮어쓰지 않는다 — "누가 언제 승인했는가"가 그대로다.
  const preservedApproval = await prisma.roleRequest.findUniqueOrThrow({
    where: { id: approved.id },
  });
  expect(preservedApproval.status).toBe(RoleRequestStatus.APPROVED);
  expect(preservedApproval.decidedById).toBe(actor.id);
  expect(preservedApproval.decidedAt).toEqual(approved.decidedAt);

  const requests = await prisma.roleRequest.findMany({
    where: { userId: target.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  expect(requests).toHaveLength(2);
  expect(requests.map((request) => request.status)).toEqual([
    RoleRequestStatus.APPROVED,
    RoleRequestStatus.REVOKED,
  ]);
  expect(requests[1]?.decidedById).toBe(actor.id);
  expect(requests[1]?.decidedAt).not.toBeNull();
  expect(requests[1]?.rejectionReason).toBeNull();
});

it('신청 없이 직접 부여된 STAFF도 회수하면 REVOKED 행이 생긴다', async () => {
  // Given — APPROVED 행이 하나도 없는 사람이다. 삽입을 "APPROVED가 있을 때만"으로
  // 좁히면 이 사람만 회수 흔적 없이 역할을 잃고, 그러면 다음 로그인에 시드가 되살린다.
  const actor = await createUser('direct-actor', Role.ADMIN);
  const target = await createUser('direct-target', Role.STAFF);
  await expect(
    prisma.roleRequest.count({ where: { userId: target.id } }),
  ).resolves.toBe(0);

  // When
  const result = await service.patchAccess(actor.githubId, target.id, {
    expectedRole: Role.STAFF,
    desiredRole: null,
    expectedAccountStatus: AccountStatus.ACTIVE,
    desiredAccountStatus: AccountStatus.ACTIVE,
    expectedPendingRequest: null,
  });

  // Then
  expect(result.role).toBeNull();
  const requests = await prisma.roleRequest.findMany({
    where: { userId: target.id },
  });
  expect(requests).toHaveLength(1);
  expect(requests[0]?.status).toBe(RoleRequestStatus.REVOKED);
  expect(requests[0]?.id).toBe(result.decidedRequest?.id);

  // 이 행이 있어야 로그인 시드 가드(`auth.repository.ts`)가 회수된 계정으로 알아본다.
  await expect(
    prisma.roleRequest.count({
      where: { userId: target.id, status: RoleRequestStatus.REVOKED },
    }),
  ).resolves.toBe(1);
});

it('회수는 새 REVOKED 행을 대상으로 하는 감사 기록을 남긴다', async () => {
  // Given
  const actor = await createUser('audit-actor', Role.ADMIN);
  const target = await createUser('audit-target', Role.STAFF);

  // When
  const result = await service.patchAccess(actor.githubId, target.id, {
    expectedRole: Role.STAFF,
    desiredRole: null,
    expectedAccountStatus: AccountStatus.ACTIVE,
    desiredAccountStatus: AccountStatus.ACTIVE,
    expectedPendingRequest: null,
  });

  // Then
  const revokedRequestId = result.decidedRequest?.id ?? 'missing';
  const logs = await prisma.auditLog.findMany({
    where: { targetId: revokedRequestId },
  });
  expect(logs).toHaveLength(1);
  expect(logs[0]).toMatchObject({
    action: ACCESS_AUDIT_ACTIONS.ROLE_REQUEST_REVOKED,
    targetType: 'ROLE_REQUEST',
    metadata: {
      eventKind: ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_REVOKED,
      before: {
        role: Role.STAFF,
        accountStatus: AccountStatus.ACTIVE,
        requestStatus: null,
      },
      after: {
        role: null,
        accountStatus: AccountStatus.ACTIVE,
        requestStatus: RoleRequestStatus.REVOKED,
      },
    },
  });
});

it.each([
  ['ADMIN', Role.ADMIN],
  ['STUDENT', Role.STUDENT],
])('%s는 여전히 역할을 비울 수 없다', async (label, role) => {
  // Given — ADMIN 회수는 마지막 관리자 가드와 무관하게 전이 자체가 막혀야 한다.
  const actor = await createUser(`not-allowed-actor-${label}`, Role.ADMIN);
  const target = await createUser(`not-allowed-target-${label}`, role);

  // When / Then
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
    prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
  ).resolves.toMatchObject({ role });
  await expect(
    prisma.roleRequest.count({ where: { userId: target.id } }),
  ).resolves.toBe(0);
});

it('두 관리자가 동시에 회수하면 한쪽만 성공하고 REVOKED 행도 하나만 남는다', async () => {
  // Given
  const firstActor = await createUser('race-actor-a', Role.ADMIN);
  const secondActor = await createUser('race-actor-b', Role.ADMIN);
  const target = await createUser('race-target', Role.STAFF);
  const command = {
    expectedRole: Role.STAFF,
    desiredRole: null,
    expectedAccountStatus: AccountStatus.ACTIVE,
    desiredAccountStatus: AccountStatus.ACTIVE,
    expectedPendingRequest: null,
  } as const;

  // When
  const outcomes = await Promise.allSettled([
    service.patchAccess(firstActor.githubId, target.id, command),
    service.patchAccess(secondActor.githubId, target.id, command),
  ]);

  // Then
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
  await expect(
    prisma.roleRequest.count({ where: { userId: target.id } }),
  ).resolves.toBe(1);
});

it('회수가 커밋되기 직전에 로그인이 끼어들어도 시드가 권한을 되살리지 못한다', async () => {
  // Given — PR0(#675)이 남긴 알려진 한계를 닫는 자리다. 회수 트랜잭션이 두 쓰기를 마치고
  // 커밋하기 전에 `AUTH_INITIAL_ROLES=STAFF` 로그인이 같은 User 행을 만지러 온다.
  const actor = await createUser('login-race-actor', Role.ADMIN);
  const target = await createUser('login-race-target', Role.STAFF);
  const approved = await prisma.roleRequest.create({
    data: {
      userId: target.id,
      status: RoleRequestStatus.APPROVED,
      decidedById: actor.id,
      decidedAt: new Date('2026-08-01T00:00:00.000Z'),
    },
  });
  const authRepository = new AuthRepository(prisma, {
    resolveInitialRole: () => Role.STAFF,
  } as unknown as AuthConfig);
  const reachedCommitBoundary = deferred();
  const releaseRevocation = deferred();
  const pausedService = new AdminAccessService(
    new PausingRevocationAdminAccessRepository(repository, async () => {
      reachedCommitBoundary.resolve();
      await releaseRevocation.promise;
    }),
    auditLog,
  );

  // When
  const revocation = pausedService.patchAccess(actor.githubId, target.id, {
    expectedRole: Role.STAFF,
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
  // 로그인이 실제로 회수 트랜잭션의 행 잠금 뒤에서 대기하는 것을 확인한 뒤에만 놓아 준다 —
  // 이것을 확인하지 않으면 두 트랜잭션이 겹치지 않은 채 통과해도 테스트가 초록이 된다.
  await waitForLockedStatement();
  releaseRevocation.resolve();
  const [revoked, loggedIn] = await Promise.all([revocation, login]);

  // Then
  expect(revoked.role).toBeNull();
  expect(loggedIn.user.role).toBeNull();
  const persisted = await prisma.user.findUniqueOrThrow({
    where: { id: target.id },
  });
  expect(persisted.role).toBeNull();
  const requests = await prisma.roleRequest.findMany({
    where: { userId: target.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  // 시드가 이겼다면 여기에 `decidedById: null`인 APPROVED 행이 하나 더 있고 역할도 STAFF다.
  expect(requests).toHaveLength(2);
  expect(requests.map((request) => request.status)).toEqual([
    RoleRequestStatus.APPROVED,
    RoleRequestStatus.REVOKED,
  ]);
  expect(requests[0]?.id).toBe(approved.id);
  expect(requests[0]?.decidedById).toBe(actor.id);
});

function createUser(label: string, role: Role | null) {
  sequence += 1;
  return prisma.user.create({
    data: {
      id: `${TEST_PREFIX}${label}:${sequence}`,
      githubId: GITHUB_ID_BASE + BigInt(sequence),
      nickname: `synthetic-184-${label}-${sequence}`,
      role,
      accountStatus: AccountStatus.ACTIVE,
    },
    select: { id: true, githubId: true },
  });
}

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve: () => resolve() };
}

/**
 * 다른 백엔드가 잠금을 기다리는 상태가 될 때까지 기다린다. 통합 테스트는 `--runInBand`로
 * 직렬 실행되므로 이 순간 대기 중인 문장은 방금 띄운 로그인 트랜잭션뿐이다.
 */
async function waitForLockedStatement(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [row] = await prisma.$queryRaw<
      readonly { readonly waiting: number }[]
    >`
      SELECT count(*)::int AS waiting
      FROM pg_stat_activity
      WHERE wait_event_type = 'Lock'
    `;
    if ((row?.waiting ?? 0) > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('로그인 트랜잭션이 회수 트랜잭션 뒤에서 대기하지 않았다.');
}
