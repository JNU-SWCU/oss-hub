import { PrismaService } from '../prisma/prisma.service';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { GithubWebhookRepository } from './github-webhook.repository';
import type { GithubWebhookRepositoryInput } from './github-webhook.types';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const TEST_PREFIX = 'test:123:';
const mappedGithubRepositoryId = 9_123_000_001n;
const unmappedGithubRepositoryId = 9_123_000_002n;

const prisma = new PrismaService();
const repository = new GithubWebhookRepository(prisma);

interface InputOptions {
  readonly githubRepositoryId: bigint;
  readonly deliveryId: string;
  readonly dedupeKey: string;
  readonly visibility?: 'PRIVATE' | 'PUBLIC';
}

function webhookInput(options: InputOptions): GithubWebhookRepositoryInput {
  const observedAt = new Date('2026-07-21T08:00:00.000Z');
  return {
    repository: {
      githubRepositoryId: options.githubRepositoryId,
      fullName: `synthetic-org/synthetic-${options.githubRepositoryId}`,
      visibility: options.visibility ?? 'PRIVATE',
      archived: false,
    },
    activity: {
      deliveryId: options.deliveryId,
      eventType: 'push',
      occurredAt: observedAt,
      dedupeKey: options.dedupeKey,
      commitDelta: 2,
      pullRequestDelta: 0,
      starDelta: 0,
    },
    observedAt,
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
    where: {
      githubRepositoryId: {
        in: [mappedGithubRepositoryId, unmappedGithubRepositoryId],
      },
    },
  });
  await prisma.repository.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
  await prisma.application.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
  await prisma.program.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
  await prisma.user.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
}

async function createMappedRepository(): Promise<void> {
  await prisma.user.create({
    data: {
      id: `${TEST_PREFIX}user`,
      githubId: 9_123_000_003n,
      login: 'synthetic-123-user',
    },
  });
  await prisma.program.create({
    data: {
      id: `${TEST_PREFIX}program`,
      name: 'Synthetic program',
      organizer: 'Synthetic organizer',
      category: 'BASIC',
      applicationTemplateKey: 'synthetic-template',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-12-31T00:00:00.000Z'),
      description: 'Synthetic fixture',
    },
  });
  await prisma.application.create({
    data: {
      id: `${TEST_PREFIX}application`,
      programId: `${TEST_PREFIX}program`,
      applicantId: `${TEST_PREFIX}user`,
      answers: {},
      applicationTemplateVersion: 1,
    },
  });
  await prisma.repository.create({
    data: {
      id: `${TEST_PREFIX}repository`,
      applicationId: `${TEST_PREFIX}application`,
      programId: `${TEST_PREFIX}program`,
      githubRepositoryId: mappedGithubRepositoryId,
      name: 'synthetic-mapped-repository',
      url: 'https://example.invalid/synthetic-repository',
    },
  });
}

describe('GithubWebhookRepository integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  beforeEach(cleanFixtures);
  afterEach(cleanFixtures);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('mapped와 unmapped Org repository를 같은 inventory 계약으로 저장한다', async () => {
    await createMappedRepository();

    await repository.persist(
      webhookInput({
        githubRepositoryId: mappedGithubRepositoryId,
        deliveryId: `${TEST_PREFIX}mapped-delivery`,
        dedupeKey: `${TEST_PREFIX}mapped-dedupe`,
      }),
    );
    await repository.persist(
      webhookInput({
        githubRepositoryId: unmappedGithubRepositoryId,
        deliveryId: `${TEST_PREFIX}unmapped-delivery`,
        dedupeKey: `${TEST_PREFIX}unmapped-dedupe`,
      }),
    );

    const inventories = await prisma.orgRepositoryInventory.findMany({
      where: {
        githubRepositoryId: {
          in: [mappedGithubRepositoryId, unmappedGithubRepositoryId],
        },
      },
      orderBy: { githubRepositoryId: 'asc' },
      select: { githubRepositoryId: true, repositoryId: true },
    });
    expect(inventories).toEqual([
      {
        githubRepositoryId: mappedGithubRepositoryId,
        repositoryId: `${TEST_PREFIX}repository`,
      },
      {
        githubRepositoryId: unmappedGithubRepositoryId,
        repositoryId: null,
      },
    ]);
  });

  it('deliveryId와 dedupeKey 재전송은 한 event로 수렴한다', async () => {
    const first = webhookInput({
      githubRepositoryId: unmappedGithubRepositoryId,
      deliveryId: `${TEST_PREFIX}duplicate-delivery`,
      dedupeKey: `${TEST_PREFIX}duplicate-dedupe`,
    });

    await expect(repository.persist(first)).resolves.toBe('stored');
    await expect(repository.persist(first)).resolves.toBe('duplicate');
    await expect(
      repository.persist({
        ...first,
        activity: {
          ...first.activity,
          deliveryId: `${TEST_PREFIX}other-delivery`,
        },
      }),
    ).resolves.toBe('duplicate');

    await expect(
      prisma.orgRepositoryActivityEvent.count({
        where: {
          inventory: { githubRepositoryId: unmappedGithubRepositoryId },
        },
      }),
    ).resolves.toBe(1);
  });

  it('visibility 변경은 inventory identity와 이전 metric을 유지한다', async () => {
    await repository.persist(
      webhookInput({
        githubRepositoryId: unmappedGithubRepositoryId,
        deliveryId: `${TEST_PREFIX}private-delivery`,
        dedupeKey: `${TEST_PREFIX}private-dedupe`,
      }),
    );
    const before = await prisma.orgRepositoryInventory.findUniqueOrThrow({
      where: { githubRepositoryId: unmappedGithubRepositoryId },
      select: { id: true },
    });

    await repository.persist(
      webhookInput({
        githubRepositoryId: unmappedGithubRepositoryId,
        deliveryId: `${TEST_PREFIX}public-delivery`,
        dedupeKey: `${TEST_PREFIX}public-dedupe`,
        visibility: 'PUBLIC',
      }),
    );

    const after = await prisma.orgRepositoryInventory.findUniqueOrThrow({
      where: { githubRepositoryId: unmappedGithubRepositoryId },
      include: { activityEvents: true },
    });
    expect(after.id).toBe(before.id);
    expect(after.visibility).toBe('PUBLIC');
    expect(after.activityEvents).toHaveLength(2);
    expect(
      after.activityEvents.reduce((sum, event) => sum + event.commitDelta, 0),
    ).toBe(4);
  });
});
