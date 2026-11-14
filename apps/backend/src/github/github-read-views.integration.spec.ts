import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { CollectionUserActivityRepository } from './collection-user-activity.repository';
import { PrismaService } from '../platform/prisma.service';
import { ContributorReadRepository } from '../platform/contributor-read.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const GITHUB_ID = 8_970_000_000_001n;
const CLOCK_ID = 8_970_000_000_021n;
const YEAR = 2119;

describe('contributor standing reads', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await purge();
  });

  afterEach(async () => {
    await purge();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('uses the latest history row once', async () => {
    await prisma.githubUserActivityObservation.createMany({
      data: [
        {
          githubId: GITHUB_ID,
          year: YEAR,
          visibility: 'PUBLIC',
          commitCount: 1,
          observedAt: new Date('2119-01-01T00:00:00.000Z'),
        },
        {
          githubId: GITHUB_ID,
          year: YEAR,
          visibility: 'PUBLIC',
          commitCount: 9,
          observedAt: new Date('2119-06-01T00:00:00.000Z'),
        },
      ],
    });

    const rows = await new ContributorReadRepository(prisma).readStandingRows({
      year: YEAR,
      visibility: 'PUBLIC',
    });
    const mine = rows.filter((row) => row.githubId === GITHUB_ID);

    expect(mine).toEqual([
      expect.objectContaining({
        githubId: GITHUB_ID,
        year: YEAR,
        visibility: 'PUBLIC',
        commitCount: 9,
      }),
    ]);
  });

  it('moves the standing clock when the same counts are observed again', async () => {
    const first = new Date('2122-04-01T00:00:00.000Z');
    const second = new Date('2122-05-01T00:00:00.000Z');
    const counts = {
      commitCount: 8,
      pullRequestCount: 0,
      issueCount: 0,
      repositoryCount: 0,
      starCount: 0,
    };
    const repository = new CollectionUserActivityRepository(prisma);
    await repository.upsertObservation({
      githubId: CLOCK_ID,
      githubLogin: 'synthetic-read-views-clock',
      year: 2122,
      ...counts,
      observedAt: first,
    });
    await repository.upsertObservation({
      githubId: CLOCK_ID,
      githubLogin: 'synthetic-read-views-clock',
      year: 2122,
      ...counts,
      observedAt: second,
    });

    const reader = new ContributorReadRepository(prisma);
    const rows = await reader.readStandingRows({
      year: 2122,
      visibility: 'PUBLIC',
    });

    expect(
      rows
        .filter((row) => row.githubId === CLOCK_ID)
        .map((row) => row.commitCount),
    ).toEqual([8]);
    await expect(
      reader.readStandingObservedAt({ year: null, visibility: 'PUBLIC' }),
    ).resolves.toEqual(second);
  });
});

async function purge(): Promise<void> {
  await prisma.githubUserActivityObservation.deleteMany({
    where: { githubId: { in: [GITHUB_ID, CLOCK_ID] } },
  });
}
