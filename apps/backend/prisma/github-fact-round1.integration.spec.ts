import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient, type UserType } from '@prisma/client';
import { CollectionIncrementalRepository } from '../src/github/collection-incremental.repository';
import { CollectionScheduleService } from '../src/github/collection-schedule.service';
import { PlatformRepository } from '../src/platform/platform.repository';
import type { PrismaService } from '../src/platform/prisma.service';
import { ProgramActivityRepository } from '../src/programs/program-activity.repository';
import { RankingRepository } from '../src/ranking/ranking.repository';
import { RankingService } from '../src/ranking/ranking.service';
import { RankingYearService } from '../src/ranking/ranking-year.service';
import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const PREFIX = 'round1-';
const YEAR = 2099;
const GAMMA_ID = 9_812_000_001n;
const ALPHA_ID = 9_812_000_002n;
const BETA_ID = 9_812_000_003n;
const STAFF_ID = 9_812_000_004n;
const ACTIVITY_REPO_ID = 9_812_100_001n;
const COLLECTION_REPO_ID = 9_812_100_002n;
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const VERIFY_SQL = readFileSync(
  resolve(__dirname, 'github-ledger-verify.sql'),
  'utf8',
);

const prisma = new PrismaClient();
const database = prisma as unknown as PrismaService;
const rankingYear = new RankingYearService();
const ranking = new RankingRepository(database);
const rankingPage = new RankingService(
  ranking,
  rankingYear,
  new CollectionScheduleService(),
);
const activity = new ProgramActivityRepository(
  database,
  new PlatformRepository(),
);
const collection = new CollectionIncrementalRepository(
  database,
  new PlatformRepository(),
);

const seoulDayStart = (instant: Date): Date =>
  new Date(
    Math.floor((instant.getTime() + SEOUL_OFFSET_MS) / DAY_MS) * DAY_MS -
      SEOUL_OFFSET_MS,
  );

const createUser = async (input: {
  readonly suffix: string;
  readonly githubId: bigint;
  readonly type: UserType;
}): Promise<void> => {
  await prisma.user.create({
    data: {
      id: `${PREFIX}${input.suffix}`,
      githubId: input.githubId,
      nickname: `${PREFIX}${input.suffix}`,
      type: input.type,
      approvalStatus: input.type === 'STAFF' ? 'APPROVED' : 'NOT_REQUIRED',
    },
  });
};

const createStanding = async (input: {
  readonly githubId: bigint;
  readonly currentCommits: number;
  readonly previousCommits: number;
  readonly currentAt: Date;
  readonly previousAt: Date;
}): Promise<void> => {
  await prisma.githubUserActivityObservation.create({
    data: {
      githubId: input.githubId,
      year: YEAR,
      visibility: 'PUBLIC',
      commitCount: input.previousCommits,
      observedAt: input.previousAt,
    },
  });
  if (input.currentCommits === input.previousCommits) return;
  await prisma.githubUserActivityObservation.create({
    data: {
      githubId: input.githubId,
      year: YEAR,
      visibility: 'PUBLIC',
      commitCount: input.currentCommits,
      observedAt: input.currentAt,
    },
  });
};

const createProgram = async (): Promise<void> => {
  await prisma.program.create({
    data: {
      id: `${PREFIX}program`,
      name: 'p',
      organizer: 'org',
      category: 'BASIC',
      applicationTemplateKey: 'basic',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-08-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-08-02T00:00:00.000Z'),
      startAt: new Date('2026-08-01T00:00:00.000Z'),
      endAt: new Date('2027-08-01T00:00:00.000Z'),
      description: 'd',
    },
  });
  await prisma.team.create({
    data: {
      id: `${PREFIX}team`,
      programId: `${PREFIX}program`,
      name: `${PREFIX}team`,
      leaderId: `${PREFIX}gamma`,
      applicantId: `${PREFIX}gamma`,
      answers: { title: `${PREFIX}team` },
      applicationTemplateVersion: 1,
    },
  });
};

const clean = async (): Promise<void> => {
  const githubIds = [GAMMA_ID, ALPHA_ID, BETA_ID, STAFF_ID];
  const repoIds = [ACTIVITY_REPO_ID, COLLECTION_REPO_ID];
  await prisma.contributionEvent.deleteMany({
    where: { repoId: { in: repoIds } },
  });
  await prisma.repo.deleteMany({
    where: { githubRepoId: { in: repoIds } },
  });
  await prisma.githubUserActivityObservation.deleteMany({
    where: { githubId: { in: githubIds } },
  });
  await prisma.githubRepository.deleteMany({
    where: { githubRepositoryId: { in: repoIds } },
  });
  await prisma.team.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.program.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
};

describe('github fact round 1', () => {
  jest.setTimeout(180_000);

  beforeAll(async () => {
    await prisma.$connect();
    await clean();
  });

  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  it('keeps an unchanged student previousRank from the ledger row before Seoul midnight', async () => {
    const version = await prisma.$queryRaw<Array<{ server_version: string }>>`
      SHOW server_version
    `;
    expect(version[0]?.server_version.startsWith('17')).toBe(true);

    const cut = seoulDayStart(new Date());
    const previousAt = new Date(cut.getTime() - 60_000);
    const currentAt = new Date(cut.getTime() + 60_000);
    await prisma.githubUserActivityObservation.deleteMany({
      where: { year: YEAR },
    });
    await createUser({ suffix: 'gamma', githubId: GAMMA_ID, type: 'STUDENT' });
    await createUser({ suffix: 'alpha', githubId: ALPHA_ID, type: 'STUDENT' });
    await createUser({ suffix: 'beta', githubId: BETA_ID, type: 'STUDENT' });
    await createUser({ suffix: 'staff', githubId: STAFF_ID, type: 'STAFF' });
    await createStanding({
      githubId: GAMMA_ID,
      currentCommits: 30,
      previousCommits: 30,
      currentAt,
      previousAt,
    });
    await createStanding({
      githubId: ALPHA_ID,
      currentCommits: 20,
      previousCommits: 5,
      currentAt,
      previousAt,
    });
    await createStanding({
      githubId: BETA_ID,
      currentCommits: 10,
      previousCommits: 1,
      currentAt,
      previousAt,
    });
    await createStanding({
      githubId: STAFF_ID,
      currentCommits: 1000,
      previousCommits: 1000,
      currentAt,
      previousAt,
    });

    const previous = await ranking.findPreviousCycleMetrics(
      { currentYear: YEAR },
      new Date(),
    );
    const byLogin = new Map(previous.map((row) => [row.githubLogin, row]));
    expect(byLogin.get(`${PREFIX}gamma`)?.commitCount).toBe(30);
    expect(byLogin.get(`${PREFIX}alpha`)?.commitCount).toBe(5);
    expect(byLogin.get(`${PREFIX}beta`)?.commitCount).toBe(1);
    expect(byLogin.has(`${PREFIX}staff`)).toBe(false);

    const page = await rankingPage.findPage(YEAR, 1, 20, null);
    const gamma = page.items.find(
      (item) => item.githubLogin === `${PREFIX}gamma`,
    );
    const alpha = page.items.find(
      (item) => item.githubLogin === `${PREFIX}alpha`,
    );
    expect(gamma).toMatchObject({ rank: 1, previousRank: 1 });
    expect(alpha).toMatchObject({ rank: 2, previousRank: 2 });
    expect(
      page.items.some((item) => item.githubLogin === `${PREFIX}staff`),
    ).toBe(false);
  });

  it('stores a pull request when the ledger repo row is missing', async () => {
    await createProgram();
    const repository = await prisma.githubRepository.create({
      data: {
        githubRepositoryId: COLLECTION_REPO_ID,
        nameWithOwner: 'synthetic/round1-collection',
        source: 'ORG_PROVISIONED',
        teamId: `${PREFIX}team`,
      },
    });
    const fact = {
      githubKey: '77',
      authorGithubId: GAMMA_ID.toString(),
      occurredAt: new Date('2026-11-01T00:00:00.000Z'),
    };

    await expect(
      collection.runInTransaction((store) =>
        store.recordContributions(repository.id, 'pull_request', [fact]),
      ),
    ).resolves.toEqual({ inserted: 1, authorFilled: 0 });
    await expect(
      collection.recordContributions(repository.id, 'pull_request', [fact]),
    ).resolves.toEqual({ inserted: 0, authorFilled: 0 });
    expect(
      await prisma.contributionEvent.count({
        where: {
          repoId: COLLECTION_REPO_ID,
          kind: 'PULL_REQUEST',
          githubKey: '77',
        },
      }),
    ).toBe(1);
  });

  it('rolls back the repo success time when the repository row is gone', async () => {
    const before = await prisma.repo.findUniqueOrThrow({
      where: { githubRepoId: COLLECTION_REPO_ID },
      select: { lastSuccessAt: true },
    });
    await expect(
      collection.runInTransaction(async (store) => {
        await store.recordRepositorySuccess(
          [COLLECTION_REPO_ID],
          new Date('2026-11-02T00:00:00.000Z'),
        );
        await store.recordContributions(
          `${PREFIX}gone-repository`,
          'pull_request',
          [
            {
              githubKey: '78',
              authorGithubId: GAMMA_ID.toString(),
              occurredAt: new Date('2026-11-02T00:00:00.000Z'),
            },
          ],
        );
      }),
    ).rejects.toThrow('contribution repository row is missing');
    expect(
      await prisma.repo.findUniqueOrThrow({
        where: { githubRepoId: COLLECTION_REPO_ID },
        select: { lastSuccessAt: true },
      }),
    ).toEqual(before);
    expect(
      await prisma.contributionEvent.count({
        where: { repoId: COLLECTION_REPO_ID, githubKey: '78' },
      }),
    ).toBe(0);
  });

  it('counts a null-author commit in program activity', async () => {
    await prisma.program.create({
      data: {
        id: `${PREFIX}activity-program`,
        name: 'p',
        organizer: 'org',
        category: 'BASIC',
        applicationTemplateKey: 'basic',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-08-01T00:00:00.000Z'),
        applicationEndAt: new Date('2026-08-02T00:00:00.000Z'),
        startAt: new Date('2026-08-01T00:00:00.000Z'),
        endAt: new Date('2027-08-01T00:00:00.000Z'),
        description: 'd',
      },
    });
    await prisma.team.create({
      data: {
        id: `${PREFIX}activity-team`,
        programId: `${PREFIX}activity-program`,
        name: `${PREFIX}activity-team`,
        leaderId: `${PREFIX}gamma`,
        applicantId: `${PREFIX}gamma`,
        answers: { title: `${PREFIX}activity-team` },
        applicationTemplateVersion: 1,
      },
    });
    await prisma.githubRepository.create({
      data: {
        githubRepositoryId: ACTIVITY_REPO_ID,
        nameWithOwner: 'synthetic/round1-activity',
        source: 'ORG_PROVISIONED',
        teamId: `${PREFIX}activity-team`,
      },
    });
    await prisma.repo.create({
      data: {
        githubRepoId: ACTIVITY_REPO_ID,
        ownerName: 'synthetic/round1-activity',
        source: 'ORG_PROVISIONED',
      },
    });
    const occurredAt = new Date('2026-10-15T00:00:00.000Z');
    const seenAt = new Date('2026-10-16T00:00:00.000Z');
    for (const key of ['sha-1', 'sha-2', 'sha-3']) {
      await prisma.contributionEvent.create({
        data: {
          repoId: ACTIVITY_REPO_ID,
          kind: 'COMMIT',
          githubKey: key,
          authorGithubId: GAMMA_ID,
          occurredAt,
          firstSeenAt: seenAt,
        },
      });
    }
    await prisma.contributionEvent.create({
      data: {
        repoId: ACTIVITY_REPO_ID,
        kind: 'COMMIT',
        githubKey: 'sha-anonymous',
        authorGithubId: null,
        occurredAt,
        firstSeenAt: seenAt,
      },
    });

    const applications = await activity.findProgramActivityApplications(
      `${PREFIX}activity-program`,
      null,
    );
    expect(applications).toHaveLength(1);
    expect(applications[0]?.repository?._count.commits).toBe(3);
    const timeline = await activity.findRepositoryActivity({
      repositoryIds: [ACTIVITY_REPO_ID],
      authorGithubId: GAMMA_ID,
    });
    expect(timeline[0]?.commitDates).toHaveLength(3);
  });

  it('fails ledger verify when the standing view drifts from the ledger', async () => {
    const verifySql = VERIFY_SQL.trim().replace(/;\s*$/, '');
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`
          INSERT INTO github_user_activity_history (
            github_id, year, visibility, commit_count, observed_at
          ) VALUES (
            9812000099, 2097, 'PUBLIC', 40, CURRENT_TIMESTAMP
          )
        `);
        await tx.$executeRawUnsafe(`
          CREATE OR REPLACE VIEW contributor_standing AS
          SELECT
            0::bigint AS github_id,
            0::int AS year,
            'PUBLIC'::"ActivityVisibility" AS visibility,
            0::int AS commit_count,
            0::int AS pull_request_count,
            0::int AS issue_count,
            0::int AS repository_count,
            0::int AS star_count,
            CURRENT_TIMESTAMP::timestamptz(3) AS observed_at
          WHERE false
        `);
        const rows =
          await tx.$queryRawUnsafe<
            Array<{ check: string; expected: bigint; actual: bigint }>
          >(verifySql);
        const commitSum = rows.find((row) => row.check === 'latest_commit_sum');
        expect(commitSum?.expected).not.toEqual(commitSum?.actual);
        throw new Error('rollback-view');
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'rollback-view') return;
      throw error;
    }
  });
});
