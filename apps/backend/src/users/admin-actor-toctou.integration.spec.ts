import { userAuditRows } from './user-history.integration-fixture';
import {
  deferred,
  backendPid,
  pidCapturingPrisma,
  waitUntilBlockedBy,
} from './admin-actor-toctou.integration-support';
import { flatProfileFixture } from './canonical-user-fixture';
import { AdminRepository } from './admin.repository';
import { UserTransitionRepository } from './user-transition.repository';
import { PrismaSerializationRetryRepository } from '../platform/prisma-serialization-retry.repository';
import { AdminAccessReadOrderingRepository } from './admin-access-read-ordering.repository';
import { AdminAccessReadRepository } from './admin-access-read.repository';
import { AdminAccessHistoryRepository } from './admin-access-history.repository';
import { canonicalUserCreateFromLabel } from './canonical-user-fixture';
import { AccountStatus } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { UserHistoryRepository } from './user-history.repository';
import { PrismaService } from '../platform/prisma.service';
import { RolesErrorCode } from './roles-error-code.error';
import {
  PausingActorReadAdminAccessRepository,
  PausingActorReadAdminProfileRepository,
} from './admin-actor-toctou.integration-support';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessService } from './admin-access.service';
import { AdminProfileRepository } from './admin-profile.repository';
import { AdminProfileService } from './admin-profile.service';
import { HistoryMetadataService } from '../platform/history-metadata.service';
import { AdminProfileMutationService } from './admin-profile-mutation.service';
import { AdminAccessMutationService } from './admin-access-mutation.service';
import { UserProfileService } from './user-profile.service';
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const TEST_PREFIX = 'test:687:admin-actor-toctou:';
const BLOCKING_OBSERVATION_TIMEOUT_MS = 20000;
const GITHUB_ID_BASE = 9006871000n;
const prisma = new PrismaService();
const userHistory = new UserHistoryRepository(new UserTransitionRepository());
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
      new AdminAccessRepository(
        pidCapturingPrisma(prisma, mutationBackend.capture),
        new AdminAccessHistoryRepository(),
        new AdminAccessReadRepository(new AdminAccessReadOrderingRepository()),
        new AdminRepository(
          pidCapturingPrisma(prisma, mutationBackend.capture),
        ),
        new UserTransitionRepository(),
      ),
      userHistory,
      new AdminAccessMutationService(
        new HistoryMetadataService(),
        new UserProfileService(),
      ),
    );
    const mutation = service.patchAccess(actor.githubId, target.id, {
      expectedRole: 'STUDENT',
      desiredRole: 'STUDENT',
      expectedAccountStatus: AccountStatus.ACTIVE,
      desiredAccountStatus: AccountStatus.DEACTIVATED,
      expectedPendingRequest: null,
    });
    await waitUntilBlockedBy(prisma, {
      waiterPid: await mutationBackend.pid,
      blockerPid: await demotion.pid,
      description: '권한 변경이 강등에 막힌 상태',
    });
    demotion.commit();
    await demotion.done;
    await expect(mutation).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ADMIN_ONLY, status: 403 },
    });
    await expect(
      prisma.user.findUniqueOrThrow({
        include: { admin: true },
        where: { id: target.id },
      }),
    ).resolves.toMatchObject({
      approvalStatus: 'NOT_REQUIRED',
      admin: null,
      accountStatus: AccountStatus.ACTIVE,
    });
    await expect(
      userAuditRows(prisma, { targetId: target.id }).then(
        (rows) => rows.length,
      ),
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
        new AdminAccessRepository(
          pidCapturingPrisma(prisma, mutationBackend.capture),
          new AdminAccessHistoryRepository(),
          new AdminAccessReadRepository(
            new AdminAccessReadOrderingRepository(),
          ),
          new AdminRepository(
            pidCapturingPrisma(prisma, mutationBackend.capture),
          ),
          new UserTransitionRepository(),
        ),
        async () => {
          reachedActorRead.resolve();
          await releaseMutation.promise;
        },
      ),
      userHistory,
      new AdminAccessMutationService(
        new HistoryMetadataService(),
        new UserProfileService(),
      ),
    );
    const mutation = service.patchAccess(actor.githubId, target.id, {
      expectedRole: 'STUDENT',
      desiredRole: 'ADMIN',
      expectedAccountStatus: AccountStatus.ACTIVE,
      desiredAccountStatus: AccountStatus.ACTIVE,
      expectedPendingRequest: null,
    });
    await reachedActorRead.promise;
    const demotion = startHeldDemotion(actor.id);
    try {
      await waitUntilBlockedBy(prisma, {
        waiterPid: await demotion.pid,
        blockerPid: await mutationBackend.pid,
        description: '강등이 진행 중인 권한 변경에 막힌 상태',
      });
    } finally {
      releaseMutation.resolve();
      demotion.commit();
    }
    await expect(mutation).resolves.toMatchObject({ role: 'ADMIN' });
    await demotion.done;
    await expect(
      prisma.user.findUniqueOrThrow({
        include: { admin: true },
        where: { id: target.id },
      }),
    ).resolves.toMatchObject({
      approvalStatus: 'NOT_REQUIRED',
      admin: { userId: target.id },
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
        new AdminProfileRepository(
          pidCapturingPrisma(prisma, mutationBackend.capture),
          new AdminAccessRepository(
            pidCapturingPrisma(prisma, mutationBackend.capture),
            new AdminAccessHistoryRepository(),
            new AdminAccessReadRepository(
              new AdminAccessReadOrderingRepository(),
            ),
            new AdminRepository(
              pidCapturingPrisma(prisma, mutationBackend.capture),
            ),
            new UserTransitionRepository(),
          ),
          new PrismaSerializationRetryRepository(),
          new UserTransitionRepository(),
        ),
        async () => {
          reachedActorRead.resolve();
          await releaseMutation.promise;
        },
      ),
      userHistory,
      new AdminProfileMutationService(
        new HistoryMetadataService(),
        new UserProfileService(),
        new AdminAccessMutationService(
          new HistoryMetadataService(),
          new UserProfileService(),
        ),
      ),
      new AdminAccessMutationService(
        new HistoryMetadataService(),
        new UserProfileService(),
      ),
    );
    const mutation = service.patchProfile(actor.githubId, target.id, {
      name: '합성 새 이름',
    });
    await reachedActorRead.promise;
    const demotion = startHeldDemotion(actor.id);
    try {
      await waitUntilBlockedBy(prisma, {
        waiterPid: await demotion.pid,
        blockerPid: await mutationBackend.pid,
        description: '강등이 진행 중인 프로필 수정에 막힌 상태',
      });
    } finally {
      releaseMutation.resolve();
      demotion.commit();
    }
    await expect(mutation).resolves.toMatchObject({ name: '합성 새 이름' });
    await demotion.done;
    await expect(
      prisma.user.findUniqueOrThrow({
        include: { admin: true },
        where: { id: target.id },
      }),
    ).resolves.toMatchObject({ name: '합성 새 이름' });
    await expect(
      prisma.user.findUniqueOrThrow({
        include: { admin: true },
        where: { id: actor.id },
      }),
    ).resolves.toMatchObject({
      approvalStatus: 'APPROVED',
      admin: null,
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
      new AdminProfileRepository(
        pidCapturingPrisma(prisma, mutationBackend.capture),
        new AdminAccessRepository(
          pidCapturingPrisma(prisma, mutationBackend.capture),
          new AdminAccessHistoryRepository(),
          new AdminAccessReadRepository(
            new AdminAccessReadOrderingRepository(),
          ),
          new AdminRepository(
            pidCapturingPrisma(prisma, mutationBackend.capture),
          ),
          new UserTransitionRepository(),
        ),
        new PrismaSerializationRetryRepository(),
        new UserTransitionRepository(),
      ),
      userHistory,
      new AdminProfileMutationService(
        new HistoryMetadataService(),
        new UserProfileService(),
        new AdminAccessMutationService(
          new HistoryMetadataService(),
          new UserProfileService(),
        ),
      ),
      new AdminAccessMutationService(
        new HistoryMetadataService(),
        new UserProfileService(),
      ),
    );
    const mutation = service.patchProfile(actor.githubId, target.id, {
      name: '합성 거부될 이름',
    });
    await waitUntilBlockedBy(prisma, {
      waiterPid: await mutationBackend.pid,
      blockerPid: await demotion.pid,
      description: '프로필 수정이 강등에 막힌 상태',
    });
    demotion.commit();
    await demotion.done;
    await expect(mutation).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ADMIN_ONLY, status: 403 },
    });
    await expect(
      prisma.user.findUniqueOrThrow({
        include: { admin: true },
        where: { id: target.id },
      }),
    ).resolves.not.toMatchObject({ name: '합성 거부될 이름' });
    await expect(
      userAuditRows(prisma, { targetId: target.id }).then(
        (rows) => rows.length,
      ),
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
        readonly {
          readonly pid: number;
        }[]
      >`SELECT pg_backend_pid()::int AS pid`;
      backend.capture(row?.pid ?? 0);
      await transaction.user.update({
        where: { id: userId },
        data: {
          ...flatProfileFixture({
            name: '합성 강등 교직원',
            studentId: null,
            department: '합성 사업단',
            memberKind: 'STAFF',
            departmentType: 'PROGRAM_OFFICE',
          }),
          approvalStatus: 'APPROVED',
          admin: { delete: true },
        },
      });
      applied.resolve();
      await release.promise;
    },
    { timeout: 60000, maxWait: 20000 },
  );
  return {
    pid: backend.pid,
    applied: applied.promise,
    commit: release.resolve,
    done,
  };
}
