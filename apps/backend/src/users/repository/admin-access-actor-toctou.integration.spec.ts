import { canonicalUserCreateFromLabel } from './canonical-user-fixture';
import { AccountStatus, MemberKind } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../../test/integration-database.guard';
import { AuditLogRepository } from '../../audit-log/repository/audit-log.repository';
import { AuditLogService } from '../../audit-log/service/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RolesErrorCode } from '../domain/roles-error-code.enum';
import { PausingActorRevalidationAdminAccessRepository } from '../service/admin-access.integration-support';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessService } from '../service/admin-access.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const repository = new AdminAccessRepository(prisma);
const auditLog = new AuditLogService(new AuditLogRepository(prisma));
const TEST_PREFIX = 'test:687:admin-access-actor-toctou:';
const GITHUB_ID_BASE = 9_006_870_000n;
let sequence = 0;

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

it('잠금 전 actor 강등이 커밋되면, 잠금 뒤 재조회가 그 강등을 보고 뮤테이션이 실패한다', async () => {
  const actor = await createUser('actor-a', 'ADMIN');
  const target = await createUser('target-a', 'STUDENT');
  const reachedPauseBeforeLock = deferred();
  const releasePauseBeforeLock = deferred();
  const pausedService = new AdminAccessService(
    new PausingActorRevalidationAdminAccessRepository(repository, {
      onFirstActorRead: async () => {
        reachedPauseBeforeLock.resolve();
        await releasePauseBeforeLock.promise;
      },
    }),
    auditLog,
  );

  const mutation = pausedService.patchAccess(actor.githubId, target.id, {
    expectedRole: 'STUDENT',
    desiredRole: 'STAFF',
    expectedAccountStatus: AccountStatus.ACTIVE,
    desiredAccountStatus: AccountStatus.ACTIVE,
    expectedPendingRequest: null,
  });
  await reachedPauseBeforeLock.promise;

  await prisma.user.update({
    where: { id: actor.id },
    data: {
      hasAdminAccess: false,
      hasStaffAccess: true,
      selectedMemberKind: MemberKind.STAFF,
    },
  });
  releasePauseBeforeLock.resolve();

  await expect(mutation).rejects.toMatchObject({
    errorCode: { code: RolesErrorCode.ADMIN_ONLY, status: 403 },
  });
  await expect(
    prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
  ).resolves.toMatchObject({
    hasStaffAccess: false,
    hasAdminAccess: false,
    accountStatus: AccountStatus.ACTIVE,
  });
  await expect(
    prisma.user.findUniqueOrThrow({ where: { id: actor.id } }),
  ).resolves.toMatchObject({
    hasStaffAccess: true,
    hasAdminAccess: false,
    accountStatus: AccountStatus.ACTIVE,
  });
});

it('잠금이 걸린 뒤엔 actor 강등 시도가 진짜로 막히고, 뮤테이션이 커밋된 뒤에야 풀린다', async () => {
  const actor = await createUser('actor-b', 'ADMIN');
  const target = await createUser('target-b', 'STUDENT');
  const mutationBackend = backendPid();
  const demotionBackend = backendPid();
  const reachedPauseAfterLock = deferred();
  const releasePauseAfterLock = deferred();
  const pausedService = new AdminAccessService(
    new PausingActorRevalidationAdminAccessRepository(
      new AdminAccessRepository(pidCapturingPrisma(mutationBackend.capture)),
      {
        onAfterLock: async () => {
          reachedPauseAfterLock.resolve();
          await releasePauseAfterLock.promise;
        },
      },
    ),
    auditLog,
  );

  const mutation = pausedService.patchAccess(actor.githubId, target.id, {
    expectedRole: 'STUDENT',
    desiredRole: 'STAFF',
    expectedAccountStatus: AccountStatus.ACTIVE,
    desiredAccountStatus: AccountStatus.ACTIVE,
    expectedPendingRequest: null,
  });
  await reachedPauseAfterLock.promise;
  const demotion = pidCapturingPrisma(demotionBackend.capture).$transaction(
    (transaction) =>
      transaction.user.update({
        where: { id: actor.id },
        data: {
          hasAdminAccess: false,
          hasStaffAccess: true,
          selectedMemberKind: MemberKind.STAFF,
        },
      }),
  );

  await waitUntilBlockedBy(
    await demotionBackend.pid,
    await mutationBackend.pid,
  );
  releasePauseAfterLock.resolve();
  const [result] = await Promise.all([mutation, demotion]);

  expect(result.role).toBe('STAFF');
  await expect(
    prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
  ).resolves.toMatchObject({
    hasStaffAccess: true,
    hasAdminAccess: false,
    accountStatus: AccountStatus.ACTIVE,
  });
  await expect(
    prisma.user.findUniqueOrThrow({ where: { id: actor.id } }),
  ).resolves.toMatchObject({
    hasStaffAccess: true,
    hasAdminAccess: false,
    accountStatus: AccountStatus.ACTIVE,
  });
});

function createUser(label: string, role: 'STUDENT' | 'STAFF' | 'ADMIN' | null) {
  sequence += 1;
  return prisma.user.create({
    data: canonicalUserCreateFromLabel(role, {
      id: `${TEST_PREFIX}${label}:${sequence}`,
      githubId: GITHUB_ID_BASE + BigInt(sequence),
      nickname: `synthetic-687-${label}-${sequence}`,
      accountStatus: AccountStatus.ACTIVE,
    }),
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

async function waitUntilBlockedBy(
  waiterPid: number,
  blockerPid: number,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [row] = await prisma.$queryRaw<
      readonly { readonly blocked: boolean }[]
    >`
      SELECT ${blockerPid}::int = ANY(pg_blocking_pids(${waiterPid}::int)) AS blocked
    `;
    if (row?.blocked === true) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `백엔드(${waiterPid})가 백엔드(${blockerPid})에 막혀 있는 상태를 관측하지 못했다.`,
  );
}
