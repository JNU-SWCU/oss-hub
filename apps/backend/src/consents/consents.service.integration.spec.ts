import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { runProfile } from '../../prisma/seed';
import { AUTH_SCENARIOS } from '../../prisma/seeds/auth';
import { prisma, seedGithubId, SeedStats } from '../../prisma/seeds/helpers';
import { PrismaService } from '../prisma/prisma.service';
import { ConsentsRepository } from './consents.repository';
import { ConsentsService } from './consents.service';
import { CURRENT_CONSENT_POLICY } from './domain/consent-policy';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const SEED_RUN_TIMEOUT_MS = 60_000;

const consentRequiredUserId = AUTH_SCENARIOS['consent-required'];
const consentRequiredGithubId = seedGithubId(consentRequiredUserId);
const alreadyConsentedUserId = AUTH_SCENARIOS['user-role-unselected'];
const alreadyConsentedGithubId = seedGithubId(alreadyConsentedUserId);

const PAST_POLICY_VERSION = '2025-12';

const allRequiredKeys = CURRENT_CONSENT_POLICY.requiredItems.map(
  (item) => item.key,
);

describe('ConsentsService integration (seed auth 시나리오)', () => {
  const prismaService = new PrismaService();
  const service = new ConsentsService(new ConsentsRepository(prismaService));

  beforeAll(async () => {
    await prismaService.$connect();

    await runProfile('auth', new SeedStats());
  }, DATABASE_CONNECTION_TIMEOUT_MS + SEED_RUN_TIMEOUT_MS);

  afterEach(async () => {
    await prisma.consent.deleteMany({
      where: { userId: consentRequiredUserId },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await prismaService.$disconnect();
  });

  it('consent-required 사용자는 현행 정책에 미동의 상태로 조회된다', async () => {
    const status = await service.getCurrent(consentRequiredGithubId);

    expect(status.consented).toBe(false);
    expect(status.policy.policyVersion).toBe(
      CURRENT_CONSENT_POLICY.policyVersion,
    );
  });

  it('동의 후 현행 policyVersion 레코드가 정확히 한 건 생성된다', async () => {
    const grant = await service.accept(consentRequiredGithubId, {
      policyVersion: CURRENT_CONSENT_POLICY.policyVersion,
      acceptedItems: allRequiredKeys,
    });

    const rows = await prisma.consent.findMany({
      where: { userId: consentRequiredUserId },
    });
    expect(grant.nextUrl).toBe(CURRENT_CONSENT_POLICY.nextUrl);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.policyVersion).toBe(CURRENT_CONSENT_POLICY.policyVersion);

    const status = await service.getCurrent(consentRequiredGithubId);
    expect(status.consented).toBe(true);
  });

  it('같은 요청을 반복해도 중복 레코드 없이 같은 동의로 수렴한다', async () => {
    const first = await service.accept(consentRequiredGithubId, {
      policyVersion: CURRENT_CONSENT_POLICY.policyVersion,
      acceptedItems: allRequiredKeys,
    });
    const second = await service.accept(consentRequiredGithubId, {
      policyVersion: CURRENT_CONSENT_POLICY.policyVersion,
      acceptedItems: allRequiredKeys,
    });

    const count = await prisma.consent.count({
      where: { userId: consentRequiredUserId },
    });
    expect(count).toBe(1);
    expect(second.consentedAt).toEqual(first.consentedAt);
  });

  it('issue-99 concurrent consent convergence', async () => {
    await prisma.consent.create({
      data: {
        userId: consentRequiredUserId,
        policyVersion: PAST_POLICY_VERSION,
      },
    });
    const startResolvers: Array<() => void> = [];
    const accepts = Array.from({ length: 12 }, () =>
      new Promise<void>((resolve) => {
        startResolvers.push(resolve);
      }).then(() =>
        service.accept(consentRequiredGithubId, {
          policyVersion: CURRENT_CONSENT_POLICY.policyVersion,
          acceptedItems: allRequiredKeys,
        }),
      ),
    );
    expect(startResolvers).toHaveLength(12);

    for (const release of startResolvers) {
      release();
    }
    const grants = await Promise.all(accepts);

    const rows = await prisma.consent.findMany({
      where: { userId: consentRequiredUserId },
      orderBy: { policyVersion: 'asc' },
    });
    const currentRows = rows.filter(
      (row) => row.policyVersion === CURRENT_CONSENT_POLICY.policyVersion,
    );
    expect(grants).toHaveLength(12);
    expect(currentRows).toHaveLength(1);
    expect(
      new Set(grants.map((grant) => grant.consentedAt.getTime())).size,
    ).toBe(1);
    expect(grants[0]?.consentedAt).toEqual(currentRows[0]?.consentedAt);
    expect(rows.map((row) => row.policyVersion)).toEqual([
      PAST_POLICY_VERSION,
      CURRENT_CONSENT_POLICY.policyVersion,
    ]);
  });

  it('현행 버전에 이미 동의한 seed 사용자(user-role-unselected)는 consented=true다 — 재방문 자동 통과 근거', async () => {
    const status = await service.getCurrent(alreadyConsentedGithubId);

    expect(status.consented).toBe(true);
  });

  it('과거 버전만 동의한 사용자는 미동의로 보이고, 새 버전 동의가 과거 행을 지우지 않는다', async () => {
    await prisma.consent.create({
      data: {
        userId: consentRequiredUserId,
        policyVersion: PAST_POLICY_VERSION,
      },
    });

    const before = await service.getCurrent(consentRequiredGithubId);
    expect(before.consented).toBe(false);

    await service.accept(consentRequiredGithubId, {
      policyVersion: CURRENT_CONSENT_POLICY.policyVersion,
      acceptedItems: allRequiredKeys,
    });

    const versions = await prisma.consent.findMany({
      where: { userId: consentRequiredUserId },
      select: { policyVersion: true },
      orderBy: { policyVersion: 'asc' },
    });
    expect(versions.map((row) => row.policyVersion)).toEqual([
      PAST_POLICY_VERSION,
      CURRENT_CONSENT_POLICY.policyVersion,
    ]);
  });
});
