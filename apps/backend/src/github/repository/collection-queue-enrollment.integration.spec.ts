import { assertIsolatedIntegrationDatabase } from '../../../test/integration-database.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { CollectionIncrementalRepository } from './collection-incremental.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const repository = new CollectionIncrementalRepository(prisma);
const githubRepositoryId = 9_000_000_146_301n;
const githubOrganizationId = 9_000_000_146_302n;
const observation = {
  githubRepositoryId,
  githubOrganizationId,
  nameWithOwner: 'synthetic-queue/observed',
  defaultBranch: 'main',
  archived: false,
  visibility: 'PUBLIC' as const,
  presence: 'PRESENT' as const,
  source: 'ORG_PROVISIONED' as const,
  observedAt: new Date('2026-08-09T14:00:00.000Z'),
};

describe('observed repository queue enrollment', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterEach(async () => {
    await prisma.githubRepository.deleteMany({ where: { githubRepositoryId } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a due row through the real observation writer and database default', async () => {
    await repository.recordRepositoryObservation(observation);
    const row = await prisma.githubRepository.findUniqueOrThrow({
      where: { githubRepositoryId },
    });
    expect(row.nextRunAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(row.failureCount).toBe(0);
    expect(row.lastSuccessAt).toBeNull();
    expect(
      (await repository.listPresentRepositories(githubOrganizationId)).map(
        (item) => item.githubRepositoryId,
      ),
    ).toEqual([githubRepositoryId]);
  });

  it('preserves an existing retry schedule when inventory observes the same repository again', async () => {
    const retryAt = new Date('2099-01-01T00:00:00.000Z');
    await repository.recordRepositoryObservation(observation);
    await prisma.githubRepository.update({
      where: { githubRepositoryId },
      data: { nextRunAt: retryAt, failureCount: 3 },
    });
    await repository.recordRepositoryObservation({
      ...observation,
      defaultBranch: 'trunk',
    });
    await expect(
      prisma.githubRepository.findUniqueOrThrow({
        where: { githubRepositoryId },
      }),
    ).resolves.toMatchObject({
      defaultBranch: 'trunk',
      nextRunAt: retryAt,
      failureCount: 3,
    });
  });

  it('keeps absent org repositories and detached external repositories out of their sweep lists', async () => {
    await repository.recordRepositoryObservation({
      ...observation,
      presence: 'ABSENT',
    });
    expect(
      await repository.listPresentRepositories(githubOrganizationId),
    ).toEqual([]);
    await prisma.githubRepository.update({
      where: { githubRepositoryId },
      data: { source: 'EXTERNAL_PUBLIC', presence: 'PRESENT' },
    });
    expect(
      await repository.listPresentRepositories(githubOrganizationId),
    ).toEqual([]);
    expect(
      (await repository.listExternalRepositories()).map(
        (item) => item.githubRepositoryId,
      ),
    ).not.toContain(githubRepositoryId);
  });
});
