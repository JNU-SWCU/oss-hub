import { assertIsolatedIntegrationDatabase } from '../../../test/integration-database.guard';
import { PrismaService } from '../../prisma/prisma.service';
import {
  type CollectionUserActivityObservationInput,
  CollectionUserActivityRepository,
} from './collection-user-activity.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const GITHUB_ID = 9_960_000_001n;
const ROLLBACK_GITHUB_ID = 9_960_000_002n;
const SEEDED_GITHUB_IDS = [GITHUB_ID, ROLLBACK_GITHUB_ID];
const YEAR = 2026;
const LOGIN = 'synthetic-snapshot-login';

const SEOUL_DAY_AS_UTC_MIDNIGHT = new Date('2026-08-19T00:00:00.000Z');
const SEOUL_NEXT_DAY_AS_UTC_MIDNIGHT = new Date('2026-08-20T00:00:00.000Z');

const SNAPSHOT_ONLY_FAULT_CONSTRAINT = 'synthetic_snapshot_rollback_probe';
const ADD_SNAPSHOT_ONLY_FAULT = `ALTER TABLE "GithubUserActivitySnapshot" ADD CONSTRAINT "${SNAPSHOT_ONLY_FAULT_CONSTRAINT}" CHECK ("githubId" <> ${ROLLBACK_GITHUB_ID})`;
const DROP_SNAPSHOT_ONLY_FAULT = `ALTER TABLE "GithubUserActivitySnapshot" DROP CONSTRAINT IF EXISTS "${SNAPSHOT_ONLY_FAULT_CONSTRAINT}"`;

const observation = (
  overrides: Partial<CollectionUserActivityObservationInput> = {},
): CollectionUserActivityObservationInput => ({
  githubId: GITHUB_ID,
  year: YEAR,
  githubLogin: LOGIN,
  commitCount: 10,
  pullRequestCount: 2,
  issueCount: 3,
  repositoryCount: 4,
  starCount: 5,
  observedAt: new Date('2026-08-19T00:30:00.000Z'),
  ...overrides,
});

describe('GithubUserActivitySnapshot 적재 (실 Postgres)', () => {
  const prisma = new PrismaService();
  const repository = new CollectionUserActivityRepository(prisma);

  const cleanup = async (): Promise<void> => {
    await prisma.githubUserActivitySnapshot.deleteMany({
      where: { githubId: { in: SEEDED_GITHUB_IDS } },
    });
    await prisma.githubUserActivityHistory.deleteMany({
      where: { githubId: { in: SEEDED_GITHUB_IDS } },
    });
  };

  const seededSnapshots = () =>
    prisma.githubUserActivitySnapshot.findMany({
      where: { githubId: { in: SEEDED_GITHUB_IDS } },
      orderBy: [{ githubId: 'asc' }, { snapshotDate: 'asc' }],
    });

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanup();
  });

  it('Seoul 날짜마다 스냅샷 한 행을 최신 값으로 유지하고 연도 행은 하나로 둔다', async () => {
    await repository.upsertObservation(observation(), {
      snapshotDate: SEOUL_DAY_AS_UTC_MIDNIGHT,
    });
    await repository.upsertObservation(
      observation({
        githubLogin: `${LOGIN}-renamed`,
        commitCount: 11,
        starCount: 7,
        observedAt: new Date('2026-08-19T01:30:00.000Z'),
      }),
      { snapshotDate: SEOUL_DAY_AS_UTC_MIDNIGHT },
    );

    expect(await seededSnapshots()).toEqual([
      expect.objectContaining({
        githubId: GITHUB_ID,
        snapshotDate: SEOUL_DAY_AS_UTC_MIDNIGHT,
        year: YEAR,
        githubLogin: `${LOGIN}-renamed`,
        commitCount: 11,
        pullRequestCount: 2,
        issueCount: 3,
        repositoryCount: 4,
        starCount: 7,
        observedAt: new Date('2026-08-19T01:30:00.000Z'),
      }),
    ]);

    await repository.upsertObservation(
      observation({
        commitCount: 21,
        observedAt: new Date('2026-08-20T00:30:00.000Z'),
      }),
      { snapshotDate: SEOUL_NEXT_DAY_AS_UTC_MIDNIGHT },
    );

    const snapshots = await seededSnapshots();
    expect(snapshots.map((row) => [row.snapshotDate, row.commitCount])).toEqual(
      [
        [SEOUL_DAY_AS_UTC_MIDNIGHT, 11],
        [SEOUL_NEXT_DAY_AS_UTC_MIDNIGHT, 21],
      ],
    );
    await expect(
      prisma.githubUserActivityHistory.findMany({
        where: { githubId: GITHUB_ID },
      }),
    ).resolves.toEqual([
      expect.objectContaining({ year: YEAR, commitCount: 21, starCount: 5 }),
    ]);
  });

  it('스냅샷 INSERT가 Postgres에서 거부되면 같은 트랜잭션의 연도 행도 롤백된다', async () => {
    await prisma.$executeRawUnsafe(ADD_SNAPSHOT_ONLY_FAULT);

    try {
      const failure = await repository
        .upsertObservation(observation({ githubId: ROLLBACK_GITHUB_ID }), {
          snapshotDate: SEOUL_DAY_AS_UTC_MIDNIGHT,
        })
        .then(
          () => null,
          (error: unknown) => error,
        );

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain(
        SNAPSHOT_ONLY_FAULT_CONSTRAINT,
      );

      await expect(
        prisma.githubUserActivityHistory.count({
          where: { githubId: ROLLBACK_GITHUB_ID, year: YEAR },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.githubUserActivitySnapshot.count({
          where: { githubId: ROLLBACK_GITHUB_ID },
        }),
      ).resolves.toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(DROP_SNAPSHOT_ONLY_FAULT);
    }
  });
});
