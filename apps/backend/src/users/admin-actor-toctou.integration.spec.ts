import { AccountStatus, Role } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { AuditLogRepository } from '../audit-log/audit-log.repository';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { RolesErrorCode } from '../roles/roles-error-code.enum';
import {
  PausingActorReadAdminAccessRepository,
  PausingActorReadAdminProfileRepository,
} from './admin-actor-toctou.integration-support';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessService } from './admin-access.service';
import { AdminProfileRepository } from './admin-profile.repository';
import { AdminProfileService } from './admin-profile.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

/**
 * 관리자 권한 검증의 TOCTOU 창을 실 PostgreSQL 위에서 닫혔는지 확인한다(#687).
 *
 * 세 가지를 각각 다른 방식으로 묻는다.
 * 1. 권한을 잃는 트랜잭션과 겹친 권한 변경이 **거부되는가** — 결과로 확인한다.
 * 2. actor를 읽은 뒤에 actor 행이 **정말 잠겨 있는가**(권한 변경 경로).
 * 3. 같은 것을 관리자 프로필 대리 수정 경로에서도.
 *
 * 2·3은 "무언가가 오래 걸렸다"가 아니라 `pg_blocking_pids`로 **누가 누구를 막고 있는지**를
 * 지목해 묻는다 — 우연한 직렬화가 통과시켜 주는 테스트는 자기가 주장하는 것을 증명하지
 * 못한다.
 */
const TEST_PREFIX = 'test:687:admin-actor-toctou:';
/**
 * 대기 관계 관측이 실패할 때 폴링(최대 5초)이 자기 오류를 던질 때까지 기다려 준다 —
 * jest 기본 5초로는 폴링보다 먼저 테스트가 끊겨 원인 대신 타임아웃만 남는다.
 */
const BLOCKING_OBSERVATION_TIMEOUT_MS = 20_000;
const GITHUB_ID_BASE = 9_006_870_000n;

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
    // Given — 강등이 먼저 행을 잡고 커밋을 미룬다. 권한 변경은 그 뒤에 들어와 잠금에 막힌다.
    const actor = await createUser('reject-actor', Role.ADMIN);
    const target = await createUser('reject-target', Role.STUDENT);
    const demotion = startHeldDemotion(actor.id);
    await demotion.applied;

    const mutationBackend = backendPid();
    const service = new AdminAccessService(
      new AdminAccessRepository(pidCapturingPrisma(mutationBackend.capture)),
      auditLog,
    );

    // When
    const mutation = service.patchAccess(actor.githubId, target.id, {
      expectedRole: Role.STUDENT,
      desiredRole: Role.STAFF,
      expectedAccountStatus: AccountStatus.ACTIVE,
      desiredAccountStatus: AccountStatus.ACTIVE,
      expectedPendingRequest: null,
    });
    // 두 트랜잭션이 같은 행에서 실제로 겹쳤다는 증거를 먼저 잡는다.
    await waitUntilBlockedBy(
      await mutationBackend.pid,
      await demotion.pid,
      '권한 변경이 강등에 막힌 상태',
    );
    demotion.commit();
    await demotion.done;

    // Then
    await expect(mutation).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ADMIN_ONLY, status: 403 },
    });
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
    ).resolves.toMatchObject({
      role: Role.STUDENT,
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
    // Given
    const actor = await createUser('pinned-actor', Role.ADMIN);
    const target = await createUser('pinned-target', Role.STUDENT);
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

    // When
    const mutation = service.patchAccess(actor.githubId, target.id, {
      expectedRole: Role.STUDENT,
      desiredRole: Role.STAFF,
      expectedAccountStatus: AccountStatus.ACTIVE,
      desiredAccountStatus: AccountStatus.ACTIVE,
      expectedPendingRequest: null,
    });
    await reachedActorRead.promise;
    const demotion = startHeldDemotion(actor.id);

    // Then — 판정이 끝난 뒤 들어온 강등은 이 트랜잭션에 막혀 있어야 한다. 막히지 않는다면
    // 판정이 잠기지 않은 값 위에서 이뤄졌다는 뜻이고, 그게 #687의 창이다.
    try {
      await waitUntilBlockedBy(
        await demotion.pid,
        await mutationBackend.pid,
        '강등이 진행 중인 권한 변경에 막힌 상태',
      );
    } finally {
      // 관측에 실패해도 두 트랜잭션을 반드시 풀어 준다 — 붙잡은 채로 끝나면 스펙이
      // 실패하는 대신 교착해 버려서 무엇이 잘못됐는지 아무도 읽을 수 없다.
      releaseMutation.resolve();
      demotion.commit();
    }
    await expect(mutation).resolves.toMatchObject({ role: Role.STAFF });
    await demotion.done;
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
    ).resolves.toMatchObject({ role: Role.STAFF });
  },
  BLOCKING_OBSERVATION_TIMEOUT_MS,
);

it(
  '프로필 대리 수정: actor를 읽은 뒤에는 actor 행이 잠겨 있어 강등이 끼어들지 못한다',
  async () => {
    // Given
    const actor = await createUser('profile-actor', Role.ADMIN);
    const target = await createUser('profile-target', Role.STUDENT);
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

    // When
    const mutation = service.patchProfile(actor.githubId, target.id, {
      name: '합성 새 이름',
    });
    await reachedActorRead.promise;
    const demotion = startHeldDemotion(actor.id);

    // Then
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
      prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
    ).resolves.toMatchObject({ name: '합성 새 이름' });
    // 강등은 막혔던 것이지 사라진 것이 아니다 — 프로필 수정이 커밋된 뒤에 이어서 반영된다.
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: actor.id } }),
    ).resolves.toMatchObject({ role: Role.STAFF });
  },
  BLOCKING_OBSERVATION_TIMEOUT_MS,
);

function createUser(label: string, role: Role) {
  sequence += 1;
  return prisma.user.create({
    data: {
      id: `${TEST_PREFIX}${label}:${sequence}`,
      githubId: GITHUB_ID_BASE + BigInt(sequence),
      nickname: `synthetic-687-${label}-${sequence}`,
      role,
      accountStatus: AccountStatus.ACTIVE,
    },
    select: { id: true, githubId: true },
  });
}

/**
 * 대상 관리자를 STAFF로 강등하되 **커밋을 붙잡고 있는** 트랜잭션을 연다.
 *
 * `applied`는 UPDATE 문이 돌아온 시점(= 행 잠금을 잡은 시점)이고, `commit()`을 부르기
 * 전까지 그 잠금은 풀리지 않는다. 반대로 다른 트랜잭션이 그 행을 먼저 잠갔다면 UPDATE
 * 자체가 막혀 `applied`가 늦어진다 — 그 대기 관계가 이 스펙이 관측하려는 것이다.
 */
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
        data: { role: Role.STAFF },
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

/**
 * 트랜잭션이 열리는 순간 그 백엔드 PID를 잡아 두는 `PrismaService` 대역.
 *
 * `$transaction`만 가로채 첫 문장으로 `pg_backend_pid()`를 실행하고, 격리 수준 등
 * 호출자가 준 옵션은 그대로 넘긴다(프로필 경로는 `RepeatableRead`를 명시한다).
 * 다만 타임아웃은 넉넉히 덮어쓴다 — 이 스펙은 트랜잭션을 일부러 멈춰 세우므로 기본
 * 5초로는 "막혀 있었다"를 관측하기 전에 트랜잭션이 먼저 끊긴다.
 */
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
      // 메서드는 원본에 바인딩해 돌려준다 — Proxy를 `this`로 받으면 Prisma 내부가 깨진다.
      return typeof value === 'function'
        ? (value as (...args: readonly unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

/**
 * `blockedPid` 백엔드가 `blockerPid` 백엔드에 막혀 있음을 PostgreSQL에 직접 물어 확인한다.
 * `pg_blocking_pids`는 그 문장을 실제로 가로막고 있는 백엔드만 돌려주므로, 이 단언이
 * 통과했다는 것은 두 트랜잭션이 같은 행에서 실제로 겹쳤다는 뜻이다.
 */
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
