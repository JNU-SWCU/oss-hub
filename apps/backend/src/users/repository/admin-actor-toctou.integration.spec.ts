import { canonicalUserCreateFromLabel } from './canonical-user-fixture';
import { AccountStatus, MemberKind } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../../test/integration-database.guard';
import { AuditLogRepository } from '../../audit-log/repository/audit-log.repository';
import { AuditLogService } from '../../audit-log/service/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RolesErrorCode } from '../domain/roles-error-code.enum';
import {
  PausingActorReadAdminAccessRepository,
  PausingActorReadAdminProfileRepository,
} from '../service/admin-actor-toctou.integration-support';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessService } from '../service/admin-access.service';
import { AdminProfileRepository } from './admin-profile.repository';
import { AdminProfileService } from '../service/admin-profile.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const TEST_PREFIX = 'test:687:admin-actor-toctou:';

const BLOCKING_OBSERVATION_TIMEOUT_MS = 20_000;

const GITHUB_ID_BASE = 9_006_871_000n;

const prisma = new PrismaService();
const auditLog = new AuditLogService(new AuditLogRepository(prisma));
let sequence = 0;

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

it(
  '권한 변경: actor를 강등하는 트랜잭션과 겹치면 ROL_004로 거부하고 아무것도 쓰지 않는다',
  async () => {
    const actor = await createUser('reject-actor', 'ADMIN');
    const target = await createUser('reject-target', 'STUDENT');
    const demotion = startHeldDemotion(actor.id);
    await demotion.applied;

    const mutationBackend = backendPid();
    const service = new AdminAccessService(
      new AdminAccessRepository(pidCapturingPrisma(mutationBackend.capture)),
      auditLog,
    );

    const mutation = service.patchAccess(actor.githubId, target.id, {
      expectedRole: 'STUDENT',
      desiredRole: 'STAFF',
      expectedAccountStatus: AccountStatus.ACTIVE,
      desiredAccountStatus: AccountStatus.ACTIVE,
      expectedPendingRequest: null,
    });

    await waitUntilBlockedBy(
      await mutationBackend.pid,
      await demotion.pid,
      '권한 변경이 강등에 막힌 상태',
    );
    demotion.commit();
    await demotion.done;

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
      prisma.auditLog.count({ where: { targetId: target.id } }),
    ).resolves.toBe(0);
  },
  BLOCKING_OBSERVATION_TIMEOUT_MS,
);

it(
  '권한 변경: actor를 읽은 뒤에는 actor 행이 잠겨 있어 강등이 끼어들지 못한다',
  async () => {
    const actor = await createUser('pinned-actor', 'ADMIN');
    const target = await createUser('pinned-target', 'STUDENT');
    const reachedActorRead = deferred();
    const releaseMutation = deferred();
    const mutationBackend = backendPid();
    const service = new AdminAccessService(
      new PausingActorReadAdminAccessRepository(
        new AdminAccessRepository(pidCapturingPrisma(mutationBackend.capture)),
        async () => {
          reachedActorRead.resolve();
          await releaseMutation.promise;
        },
      ),
      auditLog,
    );

    const mutation = service.patchAccess(actor.githubId, target.id, {
      expectedRole: 'STUDENT',
      desiredRole: 'STAFF',
      expectedAccountStatus: AccountStatus.ACTIVE,
      desiredAccountStatus: AccountStatus.ACTIVE,
      expectedPendingRequest: null,
    });
    await reachedActorRead.promise;
    const demotion = startHeldDemotion(actor.id);

    try {
      await waitUntilBlockedBy(
        await demotion.pid,
        await mutationBackend.pid,
        '강등이 진행 중인 권한 변경에 막힌 상태',
      );
    } finally {
      releaseMutation.resolve();
      demotion.commit();
    }
    await expect(mutation).resolves.toMatchObject({ role: 'STAFF' });
    await demotion.done;
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
    ).resolves.toMatchObject({
      hasStaffAccess: true,
      hasAdminAccess: false,
    });
  },
  BLOCKING_OBSERVATION_TIMEOUT_MS,
);

it(
  '프로필 대리 수정: actor를 읽은 뒤에는 actor 행이 잠겨 있어 강등이 끼어들지 못한다',
  async () => {
    const actor = await createUser('profile-actor', 'ADMIN');
    const target = await createUser('profile-target', 'STUDENT');
    const reachedActorRead = deferred();
    const releaseMutation = deferred();
    const mutationBackend = backendPid();
    const service = new AdminProfileService(
      new PausingActorReadAdminProfileRepository(
        new AdminProfileRepository(pidCapturingPrisma(mutationBackend.capture)),
        async () => {
          reachedActorRead.resolve();
          await releaseMutation.promise;
        },
      ),
      auditLog,
    );

    const mutation = service.patchProfile(actor.githubId, target.id, {
      name: '합성 새 이름',
    });
    await reachedActorRead.promise;
    const demotion = startHeldDemotion(actor.id);

    try {
      await waitUntilBlockedBy(
        await demotion.pid,
        await mutationBackend.pid,
        '강등이 진행 중인 프로필 수정에 막힌 상태',
      );
    } finally {
      releaseMutation.resolve();
      demotion.commit();
    }
    await expect(mutation).resolves.toMatchObject({ name: '합성 새 이름' });
    await demotion.done;
    await expect(
      prisma.userProfile.findUniqueOrThrow({ where: { userId: target.id } }),
    ).resolves.toMatchObject({ name: '합성 새 이름' });

    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: actor.id } }),
    ).resolves.toMatchObject({
      hasStaffAccess: true,
      hasAdminAccess: false,
    });
  },
  BLOCKING_OBSERVATION_TIMEOUT_MS,
);

it(
  '프로필 대리 수정: actor를 강등하는 트랜잭션과 겹치면 ROL_004로 거부하고 아무것도 쓰지 않는다',
  async () => {
    const actor = await createUser('profile-reject-actor', 'ADMIN');
    const target = await createUser('profile-reject-target', 'STUDENT');
    const demotion = startHeldDemotion(actor.id);
    await demotion.applied;

    const mutationBackend = backendPid();
    const service = new AdminProfileService(
      new AdminProfileRepository(pidCapturingPrisma(mutationBackend.capture)),
      auditLog,
    );

    const mutation = service.patchProfile(actor.githubId, target.id, {
      name: '합성 거부될 이름',
    });

    await waitUntilBlockedBy(
      await mutationBackend.pid,
      await demotion.pid,
      '프로필 수정이 강등에 막힌 상태',
    );
    demotion.commit();
    await demotion.done;

    await expect(mutation).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ADMIN_ONLY, status: 403 },
    });
    await expect(
      prisma.userProfile.findUniqueOrThrow({ where: { userId: target.id } }),
    ).resolves.not.toMatchObject({ name: '합성 거부될 이름' });
    await expect(
      prisma.auditLog.count({ where: { targetId: target.id } }),
    ).resolves.toBe(0);
  },
  BLOCKING_OBSERVATION_TIMEOUT_MS,
);

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

function startHeldDemotion(userId: string): {
  readonly pid: Promise<number>;
  readonly applied: Promise<void>;
  readonly commit: () => void;
  readonly done: Promise<unknown>;
} {
  const backend = backendPid();
  const applied = deferred();
  const release = deferred();
  const done = prisma.$transaction(
    async (transaction) => {
      const [row] = await transaction.$queryRaw<
        readonly { readonly pid: number }[]
      >`SELECT pg_backend_pid()::int AS pid`;
      backend.capture(row?.pid ?? 0);
      await transaction.user.update({
        where: { id: userId },
        data: {
          hasAdminAccess: false,
          hasStaffAccess: true,
          selectedMemberKind: MemberKind.STAFF,
        },
      });
      applied.resolve();
      await release.promise;
    },
    { timeout: 60_000, maxWait: 20_000 },
  );
  return {
    pid: backend.pid,
    applied: applied.promise,
    commit: release.resolve,
    done,
  };
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

function pidCapturingPrisma(capture: (pid: number) => void): PrismaService {
  return new Proxy(prisma, {
    get(target, property, receiver) {
      if (property === '$transaction') {
        return <T>(
          operation: (client: PrismaService) => Promise<T>,
          options?: Readonly<Record<string, unknown>>,
        ): Promise<T> =>
          prisma.$transaction(
            async (transaction) => {
              const [row] = await transaction.$queryRaw<
                readonly { readonly pid: number }[]
              >`SELECT pg_backend_pid()::int AS pid`;
              capture(row?.pid ?? 0);
              return operation(transaction as unknown as PrismaService);
            },
            { maxWait: 20_000, timeout: 60_000, ...options },
          );
      }
      const value: unknown = Reflect.get(target, property, receiver);

      return typeof value === 'function'
        ? (value as (...args: readonly unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

async function waitUntilBlockedBy(
  blockedPid: number,
  blockerPid: number,
  description: string,
): Promise<void> {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const [row] = await prisma.$queryRaw<
      readonly { readonly blocked: boolean }[]
    >`
      SELECT ${blockerPid}::int = ANY(pg_blocking_pids(${blockedPid}::int)) AS blocked
    `;
    if (row?.blocked === true) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `${description}를 관측하지 못했다 — 백엔드 ${blockedPid}가 ${blockerPid}에 막혀 있지 않다.`,
  );
}
