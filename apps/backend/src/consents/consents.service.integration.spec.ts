import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { runProfile } from '../../prisma/seed';
import { AUTH_SCENARIOS } from '../../prisma/seeds/auth';
import { prisma, seedGithubId, SeedStats } from '../../prisma/seeds/helpers';
import { DomainException } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import { ConsentErrorCode } from './consent-error-code.enum';
import { ConsentsRepository } from './consents.repository';
import { ConsentsService } from './consents.service';
import { CURRENT_CONSENT_POLICY } from './domain/consent-policy';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const SEED_RUN_TIMEOUT_MS = 60_000;

/** #110 auth seed 시나리오의 결정적 사용자 식별자 — 시드와 같은 파생 규칙을 쓴다. */
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
    // #110 seed 계약: consent-required는 로그인 완료 + 현행 정책 미동의 상태다.
    await runProfile('auth', new SeedStats());
  }, DATABASE_CONNECTION_TIMEOUT_MS + SEED_RUN_TIMEOUT_MS);

  afterEach(async () => {
    // 테스트가 consent-required 사용자에 추가한 행만 되돌려 시나리오 계약(미동의)을 보존한다.
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
    // Given: an older consent row and 12 requests held at the same start barrier.
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

    // When: all requests cross the deterministic barrier together.
    for (const release of startResolvers) {
      release();
    }
    const grants = await Promise.all(accepts);

    // Then: every request resolves to one current row/timestamp and the old row remains.
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
    // Given: 과거 정책 버전 동의만 있다.
    await prisma.consent.create({
      data: {
        userId: consentRequiredUserId,
        policyVersion: PAST_POLICY_VERSION,
      },
    });

    // When/Then: 현행 버전 기준으로는 미동의다 — 최신 정책을 다시 본다.
    const before = await service.getCurrent(consentRequiredGithubId);
    expect(before.consented).toBe(false);

    // When: 현행 버전에 새로 동의한다.
    await service.accept(consentRequiredGithubId, {
      policyVersion: CURRENT_CONSENT_POLICY.policyVersion,
      acceptedItems: allRequiredKeys,
    });

    // Then: append-only — 과거 행과 현행 행이 함께 남는다.
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

  it('stale policyVersion 제출은 409로 거부되고 레코드를 만들지 않는다', async () => {
    await expect(
      service.accept(consentRequiredGithubId, {
        policyVersion: PAST_POLICY_VERSION,
        acceptedItems: allRequiredKeys,
      }),
    ).rejects.toMatchObject({
      errorCode: {
        code: ConsentErrorCode.POLICY_VERSION_STALE,
        status: 409,
      },
    });

    const count = await prisma.consent.count({
      where: { userId: consentRequiredUserId },
    });
    expect(count).toBe(0);
  });

  it('issue-99 invalid exact set writes zero rows', async () => {
    // Given: the required items plus one unknown item.
    const acceptedItems = [...allRequiredKeys, 'UNRELATED_KEY'];

    // When: the invalid exact set is submitted against the current policy.
    let rejection: unknown;
    try {
      await service.accept(consentRequiredGithubId, {
        policyVersion: CURRENT_CONSENT_POLICY.policyVersion,
        acceptedItems,
      });
    } catch (error: unknown) {
      if (!(error instanceof DomainException)) {
        throw error;
      }
      rejection = error;
    }

    // Then: no consent is persisted and the service reports CON_003.
    const count = await prisma.consent.count({
      where: { userId: consentRequiredUserId },
    });
    expect(count).toBe(0);
    expect(rejection).toMatchObject({
      errorCode: {
        code: ConsentErrorCode.REQUIRED_CONSENT_MISSING,
        status: 422,
      },
    });
  });

  it('issue-99 duplicate exact set writes zero rows', async () => {
    // Given: the required set plus a duplicate of its first item.
    const acceptedItems = [...allRequiredKeys, ...allRequiredKeys.slice(0, 1)];

    // When: the duplicate-bearing set is submitted against the current policy.
    let rejection: unknown;
    try {
      await service.accept(consentRequiredGithubId, {
        policyVersion: CURRENT_CONSENT_POLICY.policyVersion,
        acceptedItems,
      });
    } catch (error: unknown) {
      if (!(error instanceof DomainException)) {
        throw error;
      }
      rejection = error;
    }

    // Then: no consent is persisted and the service reports CON_003.
    const count = await prisma.consent.count({
      where: { userId: consentRequiredUserId },
    });
    expect(count).toBe(0);
    expect(rejection).toMatchObject({
      errorCode: {
        code: ConsentErrorCode.REQUIRED_CONSENT_MISSING,
        status: 422,
      },
    });
  });
});
