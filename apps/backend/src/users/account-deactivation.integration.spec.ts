import { userAuditRows } from './user-history.integration-fixture';
import { loadRuntimeConfig } from '../platform/runtime-config.config';
import { AdminRepository } from './admin.repository';
import { UserTransitionRepository } from './user-transition.repository';
import { MemberKind } from './user-contract.config';
import { AuthConfig } from '../platform/auth.config';
import { AuthSessionService } from '../platform/auth-session.service';
import { AdminAccessReadRepository } from './admin-access-read.repository';
import { AdminAccessReadOrderingRepository } from './admin-access-read-ordering.repository';
import { AdminAccessHistoryRepository } from './admin-access-history.repository';
import { AdminAccessRepository } from './admin-access.repository';
import { AccountStatus } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { UserHistoryRepository } from './user-history.repository';
import { DomainException } from '../platform/error-code.error';
import { PrismaService } from '../platform/prisma.service';
import { AccountDeactivationRepository } from './account-deactivation.repository';
import { AccountDeactivationService } from './account-deactivation.service';
import { HistoryMetadataService } from '../platform/history-metadata.service';
import { UserProfileService } from './user-profile.service';
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const prisma = new PrismaService();
const service = new AccountDeactivationService(
  new AccountDeactivationRepository(
    prisma,
    new AdminAccessRepository(
      prisma,
      new AdminAccessHistoryRepository(),
      new AdminAccessReadRepository(new AdminAccessReadOrderingRepository()),
      new AdminRepository(prisma),
      new UserTransitionRepository(),
    ),
  ),
  new UserHistoryRepository(new UserTransitionRepository()),
  new HistoryMetadataService(),
  new UserProfileService(),
  new AuthConfig(loadRuntimeConfig({})),
  new AuthSessionService(),
);
const USER_ID = 'synthetic-self-deactivation-user';
const GITHUB_ID = 8800000000018n;
const CONCURRENT_ADMIN_IDS = [
  'synthetic-self-deactivation-admin-a',
  'synthetic-self-deactivation-admin-b',
] as const;
const CONCURRENT_ADMIN_GITHUB_IDS = [8800000000118n, 8800000000119n] as const;
describe('account self-deactivation integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({
      data: {
        approvalRequestId: null,
        approvalRequestedAt: null,
        approvalDecidedAt: null,
        approvalDecidedById: null,
        approvalReason: null,
        id: USER_ID,
        githubId: GITHUB_ID,
        nickname: 'synthetic-self-deactivation',
        policies: {
          create: {
            policyVersion: 'synthetic-policy-v1',
          },
        },
        type: MemberKind.STUDENT,
        approvalStatus: 'NOT_REQUIRED',
      },
    });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  it('blocks access while preserving consent and recording the self action atomically', async () => {
    await expect(service.deactivate(GITHUB_ID)).resolves.toEqual({
      accountStatus: AccountStatus.DEACTIVATED,
    });
    await expect(
      prisma.user.findUniqueOrThrow({
        include: { admin: true },
        where: { id: USER_ID },
      }),
    ).resolves.toMatchObject({ accountStatus: AccountStatus.DEACTIVATED });
    await expect(
      prisma.userPolicy.count({ where: { userId: USER_ID } }),
    ).resolves.toBe(1);
    const audit = await userAuditRows(prisma, {
      actorId: USER_ID,
      targetId: USER_ID,
      action: 'USER_ACCOUNT_STATUS_CHANGED',
    }).then((rows) => {
      const row = rows[0];
      if (!row) throw new TypeError('Expected persisted user audit');
      return row;
    });
    expect(audit).toMatchObject({
      targetType: 'USER',
    });
    expect(audit.metadata).toMatchObject({
      eventKind: 'ACCOUNT_STATUS_CHANGED',
      before: { accountStatus: 'ACTIVE' },
      after: { accountStatus: 'DEACTIVATED' },
    });
  });
  it('serializes concurrent admin deactivation and preserves one active admin', async () => {
    const existingActiveAdmins = await prisma.user.findMany({
      where: { admin: { isNot: null }, accountStatus: AccountStatus.ACTIVE },
      select: { id: true },
    });
    await prisma.user.updateMany({
      where: { id: { in: existingActiveAdmins.map(({ id }) => id) } },
      data: { accountStatus: AccountStatus.DEACTIVATED },
    });
    await prisma.user.createMany({
      data: CONCURRENT_ADMIN_IDS.map((id, index) => {
        const githubId = CONCURRENT_ADMIN_GITHUB_IDS[index];
        if (githubId === undefined) {
          throw new TypeError('missing synthetic admin github id');
        }
        return {
          id,
          githubId,
          nickname: `${id}-login`,
        };
      }),
    });
    await prisma.admin.createMany({
      data: CONCURRENT_ADMIN_IDS.map((userId) => ({
        userId,
        origin: 'BOOTSTRAP' as const,
      })),
    });
    try {
      const results = await Promise.allSettled(
        CONCURRENT_ADMIN_GITHUB_IDS.map((githubId) =>
          service.deactivate(githubId),
        ),
      );
      const fulfilled = results.filter(
        (result) => result.status === 'fulfilled',
      );
      const rejected = results.filter((result) => result.status === 'rejected');
      const firstRejection = rejected[0];
      const rejection: unknown =
        firstRejection?.status === 'rejected'
          ? firstRejection.reason
          : undefined;
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejection).toBeInstanceOf(DomainException);
      if (!(rejection instanceof DomainException)) {
        throw new TypeError('expected a final-admin domain rejection');
      }
      expect(rejection.errorCode).toMatchObject({
        code: 'USR_007',
        status: 409,
      });
      await expect(
        prisma.user.count({
          where: {
            admin: { isNot: null },
            accountStatus: AccountStatus.ACTIVE,
          },
        }),
      ).resolves.toBe(1);
    } finally {
      await prisma.user.updateMany({
        where: { id: { in: [...CONCURRENT_ADMIN_IDS] } },
        data: { accountStatus: AccountStatus.DEACTIVATED },
      });
      await prisma.user.updateMany({
        where: { id: { in: existingActiveAdmins.map(({ id }) => id) } },
        data: { accountStatus: AccountStatus.ACTIVE },
      });
    }
  });
});
