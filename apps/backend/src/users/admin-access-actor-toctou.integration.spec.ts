import {
  deferred,
  backendPid,
  pidCapturingPrisma,
  waitUntilBlockedBy,
} from './admin-actor-toctou.integration-support';
import { flatProfileFixture } from './canonical-user-fixture';
import { AdminRepository } from './admin.repository';
import { UserTransitionRepository } from './user-transition.repository';
import { AdminAccessReadOrderingRepository } from './admin-access-read-ordering.repository';
import { AdminAccessReadRepository } from './admin-access-read.repository';
import { AdminAccessHistoryRepository } from './admin-access-history.repository';
import { canonicalUserCreateFromLabel } from './canonical-user-fixture';
import { AccountStatus } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { UserHistoryRepository } from './user-history.repository';
import { PrismaService } from '../platform/prisma.service';
import { RolesErrorCode } from './roles-error-code.error';
import { PausingActorRevalidationAdminAccessRepository } from './admin-access.integration-support';
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
const TEST_PREFIX = 'test:687:admin-access-actor-toctou:';
const GITHUB_ID_BASE = 9006870000n;
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
    new AdminAccessMutationService(
      new AuditLogMetadataService(),
      new UserProfileService(),
    ),
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
      ...flatProfileFixture({
        name: '합성 강등 교직원',
        studentId: null,
        department: '합성 사업단',
        memberKind: 'STAFF',
        affiliationKind: 'PROGRAM_OFFICE',
      }),
      approvalStatus: 'APPROVED',
      admin: { delete: true },
    },
  });
  releasePauseBeforeLock.resolve();
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
    prisma.user.findUniqueOrThrow({
      include: { admin: true },
      where: { id: actor.id },
    }),
  ).resolves.toMatchObject({
    approvalStatus: 'APPROVED',
    admin: null,
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
      new AdminAccessRepository(
        pidCapturingPrisma(prisma, mutationBackend.capture),
        new AdminAccessHistoryRepository(),
        new AdminAccessReadRepository(new AdminAccessReadOrderingRepository()),
        new AdminRepository(
          pidCapturingPrisma(prisma, mutationBackend.capture),
        ),
        new UserTransitionRepository(),
      ),
      {
        onAfterLock: async () => {
          reachedPauseAfterLock.resolve();
          await releasePauseAfterLock.promise;
        },
      },
    ),
    auditLog,
    new AdminAccessMutationService(
      new AuditLogMetadataService(),
      new UserProfileService(),
    ),
  );
  const mutation = pausedService.patchAccess(actor.githubId, target.id, {
    expectedRole: 'STUDENT',
    desiredRole: 'STAFF',
    expectedAccountStatus: AccountStatus.ACTIVE,
    desiredAccountStatus: AccountStatus.ACTIVE,
    expectedPendingRequest: null,
  });
  await reachedPauseAfterLock.promise;
  const demotion = pidCapturingPrisma(
    prisma,
    demotionBackend.capture,
  ).$transaction((transaction) =>
    transaction.user.update({
      where: { id: actor.id },
      data: {
        ...flatProfileFixture({
          name: '합성 강등 교직원',
          studentId: null,
          department: '합성 사업단',
          memberKind: 'STAFF',
          affiliationKind: 'PROGRAM_OFFICE',
        }),
        approvalStatus: 'APPROVED',
        admin: { delete: true },
      },
    }),
  );
  await waitUntilBlockedBy(prisma, {
    waiterPid: await demotionBackend.pid,
    blockerPid: await mutationBackend.pid,
  });
  releasePauseAfterLock.resolve();
  const [result] = await Promise.all([mutation, demotion]);
  expect(result.role).toBe('STAFF');
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
    prisma.user.findUniqueOrThrow({
      include: { admin: true },
      where: { id: actor.id },
    }),
  ).resolves.toMatchObject({
    approvalStatus: 'APPROVED',
    admin: null,
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
