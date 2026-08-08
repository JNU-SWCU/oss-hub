import { AccountStatus, Role } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { AuditLogRepository } from '../audit-log/audit-log.repository';
import { AuditLogService } from '../audit-log/audit-log.service';
import { DomainException } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import { AccountDeactivationRepository } from './account-deactivation.repository';
import { AccountDeactivationService } from './account-deactivation.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const service = new AccountDeactivationService(
  new AccountDeactivationRepository(prisma),
  new AuditLogService(new AuditLogRepository(prisma)),
);
const USER_ID = 'synthetic-self-deactivation-user';
const GITHUB_ID = 8_800_000_000_018n;
const CONCURRENT_ADMIN_IDS = [
  'synthetic-self-deactivation-admin-a',
  'synthetic-self-deactivation-admin-b',
] as const;
const CONCURRENT_ADMIN_GITHUB_IDS = [
  8_800_000_000_118n,
  8_800_000_000_119n,
] as const;

describe('account self-deactivation integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({
      data: {
        id: USER_ID,
        githubId: GITHUB_ID,
        nickname: 'synthetic-self-deactivation',
        name: '합성 사용자',
        role: Role.STUDENT,
        consents: {
          create: {
            policyVersion: 'synthetic-policy-v1',
          },
        },
      },
    });
  });

  afterAll(async () => {
    // 감사 원장은 append-only이고 사용자 FK를 보존한다. 통합 DB는 실행마다 폐기되므로
    // 합성 행을 억지로 지우지 않는다.
    await prisma.$disconnect();
  });

  it('blocks access while preserving consent and recording the self action atomically', async () => {
    await expect(service.deactivate(GITHUB_ID)).resolves.toEqual({
      accountStatus: AccountStatus.DEACTIVATED,
    });

    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: USER_ID } }),
    ).resolves.toMatchObject({ accountStatus: AccountStatus.DEACTIVATED });
    await expect(
      prisma.consent.count({ where: { userId: USER_ID } }),
    ).resolves.toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        actorId: USER_ID,
        targetId: USER_ID,
        action: 'USER_ACCOUNT_STATUS_CHANGED',
      },
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
      where: { role: Role.ADMIN, accountStatus: AccountStatus.ACTIVE },
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
          role: Role.ADMIN,
        };
      }),
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
          where: { role: Role.ADMIN, accountStatus: AccountStatus.ACTIVE },
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
