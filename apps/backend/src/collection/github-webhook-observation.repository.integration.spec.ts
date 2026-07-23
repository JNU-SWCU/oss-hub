import { PrismaService } from '../prisma/prisma.service';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { GithubWebhookRepository } from './github-webhook.repository';
import type { GithubWebhookRepositoryInput } from './github-webhook.types';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const TEST_PREFIX = 'test:215:';
const githubRepositoryId = 9_215_000_001n;
const receivedAt = new Date('2026-07-23T00:00:00.000Z');

const prisma = new PrismaService();
const repository = new GithubWebhookRepository(prisma);

function webhookInput(deliveryId: string): GithubWebhookRepositoryInput {
  return {
    repository: {
      githubRepositoryId,
      fullName: 'synthetic-org/synthetic-observation-repository',
      visibility: 'PRIVATE',
      archived: false,
    },
    activity: {
      deliveryId,
      eventType: 'push',
      occurredAt: receivedAt,
      dedupeKey: `${TEST_PREFIX}dedupe`,
      commitDelta: 1,
      pullRequestDelta: 0,
      starDelta: 0,
    },
    observedAt: receivedAt,
  };
}

async function cleanFixtures(): Promise<void> {
  await prisma.githubWebhookObservation.deleteMany({
    where: { deliveryId: { startsWith: TEST_PREFIX } },
  });
  await prisma.orgRepositoryActivityEvent.deleteMany({
    where: { deliveryId: { startsWith: TEST_PREFIX } },
  });
  await prisma.orgRepositoryInventory.deleteMany({
    where: { githubRepositoryId },
  });
}

describe('GithubWebhookRepository observations integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  beforeEach(cleanFixtures);
  afterEach(cleanFixtures);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('같은 delivery 재시도는 activity 한 건과 delivery별 outcome 두 건을 남긴다', async () => {
    // Given
    const input = webhookInput(`${TEST_PREFIX}duplicate-delivery`);

    // When
    await repository.persist(input);
    await repository.persist(input);

    // Then
    await expect(
      prisma.orgRepositoryActivityEvent.count({
        where: { deliveryId: input.activity.deliveryId },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.githubWebhookObservation.findMany({
        where: { deliveryId: input.activity.deliveryId },
        orderBy: { processedAt: 'asc' },
        select: { outcome: true, errorCode: true },
      }),
    ).resolves.toEqual([
      { outcome: 'ACCEPTED', errorCode: null },
      { outcome: 'DUPLICATE', errorCode: null },
    ]);
  });

  it('ignored와 failed는 payload 없이 안정 error code만 저장한다', async () => {
    // Given
    const ignoredDeliveryId = `${TEST_PREFIX}ignored-delivery`;
    const failedDeliveryId = `${TEST_PREFIX}failed-delivery`;

    // When
    await repository.observe({
      deliveryId: ignoredDeliveryId,
      eventType: 'issues',
      receivedAt,
      outcome: 'IGNORED',
    });
    await repository.observe({
      deliveryId: failedDeliveryId,
      eventType: 'push',
      receivedAt,
      outcome: 'FAILED',
      errorCode: 'COL_WEBHOOK_INVALID_PAYLOAD',
    });

    // Then
    const observations = await prisma.githubWebhookObservation.findMany({
      where: { deliveryId: { in: [ignoredDeliveryId, failedDeliveryId] } },
      orderBy: { deliveryId: 'asc' },
    });
    expect(observations).toEqual([
      expect.objectContaining({
        deliveryId: failedDeliveryId,
        outcome: 'FAILED',
        errorCode: 'COL_WEBHOOK_INVALID_PAYLOAD',
      }),
      expect.objectContaining({
        deliveryId: ignoredDeliveryId,
        outcome: 'IGNORED',
        errorCode: null,
      }),
    ]);
    expect(Object.keys(observations[0] ?? {})).toEqual([
      'id',
      'deliveryId',
      'eventType',
      'receivedAt',
      'processedAt',
      'outcome',
      'errorCode',
    ]);
  });

  it('최근 시각과 outcome별 기간 집계를 빈 상태부터 안정적으로 반환한다', async () => {
    // Given
    const since = new Date('2026-07-22T00:00:00.000Z');
    await expect(repository.summarizeSince(since)).resolves.toEqual({
      lastReceivedAt: null,
      counts: { accepted: 0, duplicate: 0, ignored: 0, failed: 0 },
    });
    await repository.observe({
      deliveryId: `${TEST_PREFIX}summary-accepted`,
      eventType: 'push',
      receivedAt: new Date('2026-07-21T23:59:59.999Z'),
      outcome: 'ACCEPTED',
    });
    await repository.observe({
      deliveryId: `${TEST_PREFIX}summary-failed`,
      eventType: 'push',
      receivedAt,
      outcome: 'FAILED',
      errorCode: 'COL_WEBHOOK_PROCESSING_FAILED',
    });

    // When
    const summary = await repository.summarizeSince(since);

    // Then
    expect(summary).toEqual({
      lastReceivedAt: receivedAt,
      counts: { accepted: 0, duplicate: 0, ignored: 0, failed: 1 },
    });
  });

  it('별도 보존 정책 전에는 오래된 관측도 자동 삭제하지 않는다', async () => {
    // Given
    await prisma.githubWebhookObservation.createMany({
      data: [
        {
          id: `${TEST_PREFIX}old`,
          deliveryId: `${TEST_PREFIX}retention-old`,
          eventType: 'push',
          receivedAt: new Date('2025-07-23T00:00:00.000Z'),
          outcome: 'IGNORED',
        },
      ],
    });

    // When
    await repository.observe({
      deliveryId: `${TEST_PREFIX}retention-current`,
      eventType: 'push',
      receivedAt,
      outcome: 'IGNORED',
    });

    // Then
    await expect(
      prisma.githubWebhookObservation.findMany({
        where: { deliveryId: { startsWith: `${TEST_PREFIX}retention-` } },
        orderBy: { deliveryId: 'asc' },
        select: { deliveryId: true },
      }),
    ).resolves.toEqual([
      { deliveryId: `${TEST_PREFIX}retention-current` },
      { deliveryId: `${TEST_PREFIX}retention-old` },
    ]);
  });
});
