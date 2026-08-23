import { authorityFactsFor } from './canonical-user-fixture';
import { AccountStatus, StaffAccessRequestStatus } from '@prisma/client';
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
  const actor = await createUser('approved-actor', 'ADMIN');
  const target = await createUser('approved-target', 'STAFF');
  const approved = await prisma.staffAccessRequest.create({
    data: {
      userId: target.id,
      status: StaffAccessRequestStatus.APPROVED,
      decidedById: actor.id,
      decidedAt: new Date('2026-08-01T00:00:00.000Z'),
    },
  });

  // When
  const result = await service.patchAccess(actor.githubId, target.id, {
    expectedRole: 'STAFF',
    desiredRole: null,
    expectedAccountStatus: AccountStatus.ACTIVE,
    desiredAccountStatus: AccountStatus.ACTIVE,
    expectedPendingRequest: null,
  });

  // Then
  expect(result.role).toBeNull();
  expect(result.decidedRequest?.status).toBe(StaffAccessRequestStatus.REVOKED);
  expect(result.decidedRequest?.id).not.toBe(approved.id);
  const persisted = await prisma.user.findUniqueOrThrow({
    where: { id: target.id },
  });
  expect(persisted.hasStaffAccess).toBe(false);
  expect(persisted.accountStatus).toBe(AccountStatus.ACTIVE);

  // 승인 이력은 장학금 근거라 회수가 덮어쓰지 않는다 — "누가 언제 승인했는가"가 그대로다.
  const preservedApproval = await prisma.staffAccessRequest.findUniqueOrThrow({
    where: { id: approved.id },
  });
  expect(preservedApproval.status).toBe(StaffAccessRequestStatus.APPROVED);
  expect(preservedApproval.decidedById).toBe(actor.id);
  expect(preservedApproval.decidedAt).toEqual(approved.decidedAt);

  const requests = await prisma.staffAccessRequest.findMany({
    where: { userId: target.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  expect(requests).toHaveLength(2);
  expect(requests.map((request) => request.status)).toEqual([
    StaffAccessRequestStatus.APPROVED,
    StaffAccessRequestStatus.REVOKED,
  ]);
  expect(requests[1]?.decidedById).toBe(actor.id);
  expect(requests[1]?.decidedAt).not.toBeNull();
  expect(requests[1]?.rejectionReason).toBeNull();
});

it('신청 없이 직접 부여된 STAFF도 회수하면 REVOKED 행이 생긴다', async () => {
  // Given — APPROVED 행이 하나도 없는 사람이다. 삽입을 "APPROVED가 있을 때만"으로
  // 좁히면 이 사람만 회수 흔적 없이 역할을 잃고, 그러면 다음 로그인에 시드가 되살린다.
  const actor = await createUser('direct-actor', 'ADMIN');
  const target = await createUser('direct-target', 'STAFF');
  await expect(
    prisma.staffAccessRequest.count({ where: { userId: target.id } }),
  ).resolves.toBe(0);

  // When
  const result = await service.patchAccess(actor.githubId, target.id, {
    expectedRole: 'STAFF',
    desiredRole: null,
    expectedAccountStatus: AccountStatus.ACTIVE,
    desiredAccountStatus: AccountStatus.ACTIVE,
    expectedPendingRequest: null,
  });

  // Then
  expect(result.role).toBeNull();
  const requests = await prisma.staffAccessRequest.findMany({
    where: { userId: target.id },
  });
  expect(requests).toHaveLength(1);
  expect(requests[0]?.status).toBe(StaffAccessRequestStatus.REVOKED);
  expect(requests[0]?.id).toBe(result.decidedRequest?.id);

  // 이 행이 있어야 로그인 시드 가드(`auth.repository.ts`)가 회수된 계정으로 알아본다.
  await expect(
    prisma.staffAccessRequest.count({
      where: { userId: target.id, status: StaffAccessRequestStatus.REVOKED },
    }),
  ).resolves.toBe(1);
});

it('회수는 새 REVOKED 행을 대상으로 하는 감사 기록을 남긴다', async () => {
  // Given
  const actor = await createUser('audit-actor', 'ADMIN');
  const target = await createUser('audit-target', 'STAFF');

  // When
  const result = await service.patchAccess(actor.githubId, target.id, {
    expectedRole: 'STAFF',
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
        role: 'STAFF',
        accountStatus: AccountStatus.ACTIVE,
        requestStatus: null,
      },
      after: {
        role: null,
        accountStatus: AccountStatus.ACTIVE,
        requestStatus: StaffAccessRequestStatus.REVOKED,
      },
    },
  });
});

it.each<[string, 'ADMIN' | 'STUDENT']>([
  ['ADMIN', 'ADMIN'],
  ['STUDENT', 'STUDENT'],
])('%s는 여전히 역할을 비울 수 없다', async (label, role) => {
  // Given — ADMIN 회수는 마지막 관리자 가드와 무관하게 전이 자체가 막혀야 한다.
  const actor = await createUser(`not-allowed-actor-${label}`, 'ADMIN');
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
    prisma.staffAccessRequest.count({ where: { userId: target.id } }),
  ).resolves.toBe(0);
});

it('두 관리자가 동시에 회수하면 한쪽만 성공하고 REVOKED 행도 하나만 남는다', async () => {
  // Given
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
    prisma.staffAccessRequest.count({ where: { userId: target.id } }),
  ).resolves.toBe(1);
});

it('REVOKED 행 삽입 직후 실패하면 역할 CAS까지 함께 되돌아간다', async () => {
  // Given — 두 쓰기가 한 트랜잭션이라는 주장의 반대편이다. 삽입까지 끝난 뒤 터뜨려
  // "역할은 비었는데 회수 이력은 없는" 상태가 커밋되지 않는지 본다.
  const actor = await createUser('rollback-insert-actor', 'ADMIN');
  const target = await createUser('rollback-insert-target', 'STAFF');
  const failingService = new AdminAccessService(
    new PausingRevocationAdminAccessRepository(repository, () =>
      Promise.reject(new Error('synthetic-revocation-failure')),
    ),
    auditLog,
  );

  // When / Then
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
    prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
  ).resolves.toMatchObject({
    role: 'STAFF',
    accountStatus: AccountStatus.ACTIVE,
  });
  await expect(
    prisma.staffAccessRequest.count({ where: { userId: target.id } }),
  ).resolves.toBe(0);
});

it('감사 기록이 실패하면 역할 CAS와 REVOKED 행이 함께 되돌아간다', async () => {
  // Given — 감사는 같은 트랜잭션의 writer로 쓴다. 그 규약이 깨지면 "회수됐는데 기록은
  // 없는" 행이 남고, AuditLog는 append-only라 나중에 채워 넣을 수도 없다.
  const actor = await createUser('rollback-audit-actor', 'ADMIN');
  const target = await createUser('rollback-audit-target', 'STAFF');
  const failingAudit = {
    record: () => Promise.reject(new Error('synthetic-audit-failure')),
  } as unknown as AuditLogService;
  const failingService = new AdminAccessService(repository, failingAudit);

  // When / Then
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
    prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
  ).resolves.toMatchObject({
    role: 'STAFF',
    accountStatus: AccountStatus.ACTIVE,
  });
  await expect(
    prisma.staffAccessRequest.count({ where: { userId: target.id } }),
  ).resolves.toBe(0);
});

it('회수가 커밋되기 직전에 로그인이 끼어들어도 시드가 권한을 되살리지 못한다', async () => {
  // Given — PR0(#675)이 남긴 알려진 한계를 닫는 자리다. 회수 트랜잭션이 두 쓰기를 마치고
  // 커밋하기 전에 `AUTH_INITIAL_ROLES=STAFF` 로그인이 같은 User 행을 만지러 온다.
  const actor = await createUser('login-race-actor', 'ADMIN');
  const target = await createUser('login-race-target', 'STAFF');
  const approved = await prisma.staffAccessRequest.create({
    data: {
      userId: target.id,
      status: StaffAccessRequestStatus.APPROVED,
      decidedById: actor.id,
      decidedAt: new Date('2026-08-01T00:00:00.000Z'),
    },
  });
  // 두 트랜잭션의 백엔드 PID를 각자의 트랜잭션 안에서 잡는다 — 나중에 "로그인이
  // **회수에** 막혀 있다"를 pg_blocking_pids로 지목해 단언하기 위해서다.
  const revocationBackend = backendPid();
  const loginBackend = backendPid();
  const authRepository = new AuthRepository(
    pidCapturingPrisma(loginBackend.capture),
    { resolveInitialRole: () => 'STAFF' } as unknown as AuthConfig,
  );
  const reachedCommitBoundary = deferred();
  const releaseRevocation = deferred();
  const pausedService = new AdminAccessService(
    new PausingRevocationAdminAccessRepository(
      new AdminAccessRepository(pidCapturingPrisma(revocationBackend.capture)),
      async () => {
        reachedCommitBoundary.resolve();
        await releaseRevocation.promise;
      },
    ),
    auditLog,
  );

  // When
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
  // 로그인이 **회수 트랜잭션에** 막혀 있음을 지목해 확인한 뒤에만 놓아 준다. "무언가가
  // 대기 중"으로는 부족하다 — 다른 세션의 대기로도 통과해 버리면 이 테스트는 자기가
  // 주장하는 것을 증명하지 못한다.
  await waitUntilLoginIsBlockedByRevocation(
    await loginBackend.pid,
    await revocationBackend.pid,
  );
  releaseRevocation.resolve();
  const [revoked, loggedIn] = await Promise.all([revocation, login]);

  // Then
  expect(revoked.role).toBeNull();
  expect(loggedIn.user.memberKind).toBeNull();
  const persisted = await prisma.user.findUniqueOrThrow({
    where: { id: target.id },
  });
  expect(persisted.hasStaffAccess).toBe(false);
  const requests = await prisma.staffAccessRequest.findMany({
    where: { userId: target.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  // 시드가 이겼다면 여기에 `decidedById: null`인 APPROVED 행이 하나 더 있고 역할도 STAFF다.
  expect(requests).toHaveLength(2);
  expect(requests.map((request) => request.status)).toEqual([
    StaffAccessRequestStatus.APPROVED,
    StaffAccessRequestStatus.REVOKED,
  ]);
  expect(requests[0]?.id).toBe(approved.id);
  expect(requests[0]?.decidedById).toBe(actor.id);
});

function createUser(label: string, role: 'STUDENT' | 'STAFF' | 'ADMIN' | null) {
  sequence += 1;
  return prisma.user.create({
    data: {
      id: `${TEST_PREFIX}${label}:${sequence}`,
      githubId: GITHUB_ID_BASE + BigInt(sequence),
      nickname: `synthetic-184-${label}-${sequence}`,
      ...authorityFactsFor(role),
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
 * 트랜잭션이 열리는 순간 그 트랜잭션을 실행하는 백엔드 PID를 잡아 두는 PrismaService 대역.
 *
 * 실 PrismaService를 그대로 위임하고 `$transaction`만 가로채 첫 문장으로
 * `pg_backend_pid()`를 실행한다 — 회수·로그인이 각각 어느 커넥션에서 도는지 알아야
 * "누가 누구를 막고 있는가"를 지목할 수 있다.
 */
function pidCapturingPrisma(capture: (pid: number) => void): PrismaService {
  return new Proxy(prisma, {
    get(target, property, receiver) {
      if (property === '$transaction') {
        return <T>(
          operation: (client: PrismaService) => Promise<T>,
        ): Promise<T> =>
          prisma.$transaction(async (transaction) => {
            const [row] = await transaction.$queryRaw<
              readonly { readonly pid: number }[]
            >`SELECT pg_backend_pid()::int AS pid`;
            capture(row?.pid ?? 0);
            return operation(transaction as unknown as PrismaService);
          });
      }
      const value: unknown = Reflect.get(target, property, receiver);
      // 메서드는 원본에 바인딩해 돌려준다 — Proxy를 `this`로 받으면 Prisma 내부가 깨진다.
      return typeof value === 'function'
        ? (value as (...args: readonly unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

function backendPid(): {
  readonly pid: Promise<number>;
  readonly capture: (pid: number) => void;
} {
  let capture: (pid: number) => void = () => undefined;
  const pid = new Promise<number>((resolve) => {
    capture = resolve;
  });
  return { pid, capture: (value: number) => capture(value) };
}

/**
 * 로그인 백엔드가 **회수 백엔드에** 막혀 있음을 PostgreSQL에 직접 물어 확인한다.
 * `pg_blocking_pids`는 그 문장을 실제로 가로막고 있는 백엔드만 돌려주므로, 이 단언이
 * 통과했다는 것은 두 트랜잭션이 같은 행에서 겹쳤다는 뜻이다.
 */
async function waitUntilLoginIsBlockedByRevocation(
  loginPid: number,
  revocationPid: number,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [row] = await prisma.$queryRaw<
      readonly { readonly blocked: boolean }[]
    >`
      SELECT ${revocationPid}::int = ANY(pg_blocking_pids(${loginPid}::int)) AS blocked
    `;
    if (row?.blocked === true) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `로그인 백엔드(${loginPid})가 회수 백엔드(${revocationPid})에 막혀 있는 상태를 관측하지 못했다.`,
  );
}
