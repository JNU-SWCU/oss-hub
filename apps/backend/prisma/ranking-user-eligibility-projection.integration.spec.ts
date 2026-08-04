import { AccountStatus, Prisma, PrismaClient } from '@prisma/client';

import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import { CURRENT_CONSENT_POLICY } from '../src/consents/domain/consent-policy';

jest.setTimeout(60_000);

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaClient();
const TEST_PREFIX = 'test:237:';
const USER_ID = `${TEST_PREFIX}user`;
const GITHUB_ID = 9_237_000_001n;

async function projectedPolicyVersion(): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ policyVersion: string }>>(
    Prisma.sql`
      SELECT "policyVersion"
      FROM "RankingUserEligibilityProjection"
      WHERE "githubUserId" = ${GITHUB_ID}
    `,
  );
  return rows[0]?.policyVersion ?? null;
}

async function cleanFixtures(): Promise<void> {
  await prisma.$executeRaw(
    Prisma.sql`DELETE FROM "ConsentWithdrawal" WHERE "userId" = ${USER_ID}`,
  );
  await prisma.consent.deleteMany({ where: { userId: USER_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
}

async function createUser(): Promise<void> {
  await prisma.user.create({
    data: { id: USER_ID, githubId: GITHUB_ID, nickname: 'test-237-user' },
  });
}

describe('RankingUserEligibilityProjection integration', () => {
  beforeAll(() => prisma.$connect());
  beforeEach(async () => {
    await cleanFixtures();
    await createUser();
  });
  afterEach(cleanFixtures);
  afterAll(() => prisma.$disconnect());

  it('projects only an active user with the current consent policy', async () => {
    await prisma.consent.create({
      data: { userId: USER_ID, policyVersion: 'obsolete-policy' },
    });
    await expect(projectedPolicyVersion()).resolves.toBeNull();

    await prisma.consent.create({
      data: {
        userId: USER_ID,
        policyVersion: CURRENT_CONSENT_POLICY.policyVersion,
      },
    });
    await expect(projectedPolicyVersion()).resolves.toBe(
      CURRENT_CONSENT_POLICY.policyVersion,
    );
  });

  it('removes eligibility immediately when the account becomes inactive', async () => {
    await prisma.consent.create({
      data: {
        userId: USER_ID,
        policyVersion: CURRENT_CONSENT_POLICY.policyVersion,
      },
    });
    await prisma.user.update({
      where: { id: USER_ID },
      data: { accountStatus: AccountStatus.DEACTIVATED },
    });
    await expect(projectedPolicyVersion()).resolves.toBeNull();
  });

  it('rejects a withdrawal whose user does not own the consent', async () => {
    const consent = await prisma.consent.create({
      data: {
        userId: USER_ID,
        policyVersion: CURRENT_CONSENT_POLICY.policyVersion,
      },
    });
    const otherUserId = `${TEST_PREFIX}other-user`;
    await prisma.user.create({
      data: {
        id: otherUserId,
        githubId: GITHUB_ID + 1n,
        nickname: 'test-237-other-user',
      },
    });

    await expect(
      prisma.$executeRaw(
        Prisma.sql`
          INSERT INTO "ConsentWithdrawal" ("id", "consentId", "userId", "withdrawnAt")
          VALUES (${`${TEST_PREFIX}invalid-withdrawal`}, ${consent.id}, ${otherUserId}, NOW())
        `,
      ),
    ).rejects.toThrow();
    await expect(projectedPolicyVersion()).resolves.toBe(
      CURRENT_CONSENT_POLICY.policyVersion,
    );

    await prisma.user.delete({ where: { id: otherUserId } });
  });
  it('removes eligibility immediately after consent withdrawal', async () => {
    const consent = await prisma.consent.create({
      data: {
        userId: USER_ID,
        policyVersion: CURRENT_CONSENT_POLICY.policyVersion,
      },
    });
    await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO "ConsentWithdrawal" ("id", "consentId", "userId", "withdrawnAt")
        VALUES (${`${TEST_PREFIX}withdrawal`}, ${consent.id}, ${USER_ID}, NOW())
      `,
    );
    await expect(projectedPolicyVersion()).resolves.toBeNull();
  });
});
