import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PrismaClient,
  type ActivityVisibility,
  type UserType,
} from '@prisma/client';
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
const COPY_SQL = readFileSync(
  resolve(__dirname, 'github-ledger-copy.sql'),
  'utf8',
);
const REVERSE_SQL = readFileSync(
  resolve(__dirname, 'github-ledger-reverse.sql'),
  'utf8',
);
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

const statements = (sql: string): string[] => {
  const stripped = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  const parts: string[] = [];
  let current = '';
  let fence: string | null = null;
  let inString = false;
  for (let index = 0; index < stripped.length; index += 1) {
    const rest = stripped.slice(index);
    if (fence) {
      if (rest.startsWith(fence)) {
        current += fence;
        index += fence.length - 1;
        fence = null;
        continue;
      }
      current += stripped[index];
      continue;
    }
    if (inString) {
      current += stripped[index];
      if (stripped[index] === "'" && stripped[index + 1] === "'") {
        current += "'";
        index += 1;
        continue;
      }
      if (stripped[index] === "'") inString = false;
      continue;
    }
    const marker = /^\$[A-Za-z0-9_]*\$/.exec(rest);
    if (marker) {
      fence = marker[0];
      current += fence;
      index += fence.length - 1;
      continue;
    }
    if (stripped[index] === "'") {
      inString = true;
      current += "'";
      continue;
    }
    if (stripped[index] === ';') {
      const statement = current.trim();
      if (statement !== '' && statement !== 'BEGIN' && statement !== 'COMMIT') {
        parts.push(statement);
      }
      current = '';
      continue;
    }
    current += stripped[index];
  }
  const tail = current.trim();
  if (tail !== '' && tail !== 'BEGIN' && tail !== 'COMMIT') parts.push(tail);
  return parts;
};

const runScript = async (sql: string): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    for (const statement of statements(sql)) {
      await tx.$executeRawUnsafe(statement);
    }
  });
};

interface RankRow {
  readonly githubId: bigint;
  readonly githubLogin: string;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
}

const rankedActivity = (row: RankRow) => ({
  githubId: row.githubId,
  githubLogin: row.githubLogin,
  total: rankingYear.activityTotal(row),
  commitCount: row.commitCount,
  pullRequestCount: row.pullRequestCount,
  issueCount: row.issueCount,
  repositoryCount: row.repositoryCount,
  starCount: row.starCount,
});

const rankOf = (rows: readonly RankRow[]): ReadonlyMap<string, number> => {
  const ranked = [...rows].sort((left, right) =>
    rankingYear.compareRanked(rankedActivity(left), rankedActivity(right)),
  );
  return new Map(ranked.map((row, index) => [row.githubLogin, index + 1]));
};

const previousRanksFromCycleSnapshot = async (
  year: number,
): Promise<ReadonlyMap<string, number>> => {
  const [snapshots, students] = await Promise.all([
    prisma.githubUserActivityCycleSnapshot.findMany({ where: { year } }),
    prisma.user.findMany({
      where: { type: 'STUDENT' },
      select: { githubId: true, nickname: true },
    }),
  ]);
  const folded = new Map<string, RankRow>();
  for (const row of snapshots) {
    const key = row.githubId.toString();
    const current = folded.get(key);
    if (current === undefined) {
      folded.set(key, {
        githubId: row.githubId,
        githubLogin: '',
        commitCount: row.commitCount,
        pullRequestCount: row.pullRequestCount,
        issueCount: row.issueCount,
        repositoryCount: row.repositoryCount,
        starCount: row.visibility === 'PUBLIC' ? row.starCount : 0,
      });
      continue;
    }
    folded.set(key, {
      ...current,
      commitCount: current.commitCount + row.commitCount,
      pullRequestCount: current.pullRequestCount + row.pullRequestCount,
      issueCount: current.issueCount + row.issueCount,
      repositoryCount: current.repositoryCount + row.repositoryCount,
      starCount:
        row.visibility === 'PUBLIC' && row.year >= year
          ? row.starCount
          : current.starCount,
    });
  }
  return rankOf(
    students
      .filter((student) => student.nickname)
      .map((student) => {
        const totals = folded.get(student.githubId.toString());
        return {
          githubId: student.githubId,
          githubLogin: student.nickname,
          commitCount: totals?.commitCount ?? 0,
          pullRequestCount: totals?.pullRequestCount ?? 0,
          issueCount: totals?.issueCount ?? 0,
          repositoryCount: totals?.repositoryCount ?? 0,
          starCount: totals?.starCount ?? 0,
        };
      }),
  );
};

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

const createLegacyStanding = async (input: {
  readonly githubId: bigint;
  readonly login: string;
  readonly currentCommits: number;
  readonly previousCommits: number;
  readonly currentAt: Date;
  readonly previousAt: Date;
}): Promise<void> => {
  await prisma.githubUserActivityHistory.create({
    data: {
      githubId: input.githubId,
      githubLogin: input.login,
      year: YEAR,
      visibility: 'PUBLIC',
      commitCount: input.currentCommits,
      observedAt: input.currentAt,
    },
  });
  await prisma.githubUserActivityCycleSnapshot.create({
    data: {
      githubId: input.githubId,
      githubLogin: input.login,
      year: YEAR,
      visibility: 'PUBLIC',
      commitCount: input.previousCommits,
      observedAt: input.previousAt,
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
  await prisma.collectionCommitFact.deleteMany({
    where: { repository: { githubRepositoryId: { in: repoIds } } },
  });
  await prisma.collectionPullRequestFact.deleteMany({
    where: { repository: { githubRepositoryId: { in: repoIds } } },
  });
  await prisma.collectionReleaseFact.deleteMany({
    where: { repository: { githubRepositoryId: { in: repoIds } } },
  });
  await prisma.githubIssueHistory.deleteMany({
    where: { repository: { githubRepositoryId: { in: repoIds } } },
  });
  await prisma.collectionRepositoryStream.deleteMany({
    where: { repository: { githubRepositoryId: { in: repoIds } } },
  });
  await prisma.contribution.deleteMany({
    where: { repository: { githubRepositoryId: { in: repoIds } } },
  });
  await prisma.githubUserActivityObservation.deleteMany({
    where: { githubId: { in: githubIds } },
  });
  await prisma.githubUserActivityHistory.deleteMany({
    where: { githubId: { in: githubIds } },
  });
  await prisma.githubUserActivityCycleSnapshot.deleteMany({
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

  it('keeps an unchanged student previousRank equal to the cycle snapshot', async () => {
    const version = await prisma.$queryRaw<Array<{ server_version: string }>>`
      SHOW server_version
    `;
    expect(version[0]?.server_version.startsWith('17')).toBe(true);

    const cut = seoulDayStart(new Date());
    const previousAt = new Date(cut.getTime() - 60_000);
    const currentAt = new Date(cut.getTime() + 60_000);
    await prisma.githubUserActivityHistory.deleteMany({
      where: { year: YEAR },
    });
    await prisma.githubUserActivityCycleSnapshot.deleteMany({
      where: { year: YEAR },
    });
    await prisma.githubUserActivityObservation.deleteMany({
      where: { year: YEAR },
    });
    await createUser({ suffix: 'gamma', githubId: GAMMA_ID, type: 'STUDENT' });
    await createUser({ suffix: 'alpha', githubId: ALPHA_ID, type: 'STUDENT' });
    await createUser({ suffix: 'beta', githubId: BETA_ID, type: 'STUDENT' });
    await createUser({ suffix: 'staff', githubId: STAFF_ID, type: 'STAFF' });
    await createLegacyStanding({
      githubId: GAMMA_ID,
      login: `${PREFIX}gamma`,
      currentCommits: 30,
      previousCommits: 30,
      currentAt,
      previousAt,
    });
    await createLegacyStanding({
      githubId: ALPHA_ID,
      login: `${PREFIX}alpha`,
      currentCommits: 20,
      previousCommits: 5,
      currentAt,
      previousAt,
    });
    await createLegacyStanding({
      githubId: BETA_ID,
      login: `${PREFIX}beta`,
      currentCommits: 10,
      previousCommits: 1,
      currentAt,
      previousAt,
    });
    await createLegacyStanding({
      githubId: STAFF_ID,
      login: `${PREFIX}staff`,
      currentCommits: 1000,
      previousCommits: 1000,
      currentAt,
      previousAt,
    });

    await runScript(COPY_SQL);

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

  it('stores an accepted pull request when the ledger repo row is missing', async () => {
    await createProgram();
    const repository = await prisma.githubRepository.create({
      data: {
        githubRepositoryId: COLLECTION_REPO_ID,
        nameWithOwner: 'synthetic/round1-collection',
        source: 'ORG_PROVISIONED',
        teamId: `${PREFIX}team`,
      },
    });
    const registered = new Set([GAMMA_ID]);
    const createdAt = new Date('2026-11-01T00:00:00.000Z');
    await collection.runInTransaction(async (store) => {
      await store.recordPullRequestFacts(
        repository.id,
        [
          {
            githubPullRequestId: 77n,
            state: 'open',
            createdAt,
            authorGithubId: GAMMA_ID,
            authorGithubLogin: `${PREFIX}gamma`,
          },
        ],
        registered,
      );
      await store.upsertStreamFrontier({
        repositoryId: repository.id,
        streamType: 'PULL_REQUEST',
        frontierCreatedAt: createdAt,
        frontierEntityId: 77n,
        expectedSyncEpoch: null,
      });
    });

    expect(
      await prisma.contributionEvent.count({
        where: {
          repoId: COLLECTION_REPO_ID,
          kind: 'PULL_REQUEST',
          githubKey: '77',
        },
      }),
    ).toBe(1);
    await collection.recordPullRequestFacts(
      repository.id,
      [
        {
          githubPullRequestId: 77n,
          state: 'open',
          createdAt,
          authorGithubId: GAMMA_ID,
        },
      ],
      registered,
    );
    expect(
      await prisma.contributionEvent.count({
        where: { repoId: COLLECTION_REPO_ID, githubKey: '77' },
      }),
    ).toBe(1);
    expect(
      await prisma.collectionRepositoryStream.findUnique({
        where: {
          repositoryId_streamType: {
            repositoryId: repository.id,
            streamType: 'PULL_REQUEST',
          },
        },
      }),
    ).toMatchObject({ frontierEntityId: 77n });
  });

  it('rolls back the stream frontier when the repository row is gone', async () => {
    const repository = await prisma.githubRepository.findUniqueOrThrow({
      where: { githubRepositoryId: COLLECTION_REPO_ID },
    });
    const stream = await prisma.collectionRepositoryStream.findUniqueOrThrow({
      where: {
        repositoryId_streamType: {
          repositoryId: repository.id,
          streamType: 'PULL_REQUEST',
        },
      },
    });
    const createdAt = new Date('2026-11-02T00:00:00.000Z');
    await expect(
      collection.runInTransaction(async (store) => {
        await store.upsertStreamFrontier({
          repositoryId: repository.id,
          streamType: 'PULL_REQUEST',
          frontierCreatedAt: createdAt,
          frontierEntityId: 78n,
          expectedSyncEpoch: stream.syncEpoch,
        });
        await store.recordPullRequestFacts(
          `${PREFIX}gone-repository`,
          [
            {
              githubPullRequestId: 78n,
              state: 'open',
              createdAt,
              authorGithubId: GAMMA_ID,
            },
          ],
          new Set([GAMMA_ID]),
        );
      }),
    ).rejects.toThrow('contribution repository row is missing');
    expect(
      await prisma.collectionRepositoryStream.findUnique({
        where: {
          repositoryId_streamType: {
            repositoryId: repository.id,
            streamType: 'PULL_REQUEST',
          },
        },
      }),
    ).toMatchObject({ frontierEntityId: 77n, syncEpoch: stream.syncEpoch });
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
    expect(applications[0]?.repository?._count.commits).toBe(4);
    const timeline = await activity.findRepositoryActivity({
      repositoryIds: [ACTIVITY_REPO_ID],
      authorGithubId: GAMMA_ID,
    });
    expect(timeline[0]?.commitDates).toHaveLength(3);
  });

  it('restores D-image program activity, timeline and previousRank from the ledger', async () => {
    const cut = seoulDayStart(new Date());
    const previousAt = new Date(cut.getTime() - 60_000);
    const currentAt = new Date(cut.getTime() + 60_000);
    await prisma.githubUserActivityObservation.deleteMany({
      where: { githubId: { in: [GAMMA_ID, ALPHA_ID, BETA_ID] }, year: YEAR },
    });
    const standings: readonly {
      readonly githubId: bigint;
      readonly previousCommits: number;
      readonly currentCommits: number;
    }[] = [
      { githubId: GAMMA_ID, previousCommits: 30, currentCommits: 30 },
      { githubId: ALPHA_ID, previousCommits: 5, currentCommits: 20 },
      { githubId: BETA_ID, previousCommits: 1, currentCommits: 10 },
    ];
    for (const standing of standings) {
      await prisma.githubUserActivityObservation.create({
        data: {
          githubId: standing.githubId,
          year: YEAR,
          visibility: 'PUBLIC' satisfies ActivityVisibility,
          commitCount: standing.previousCommits,
          observedAt: previousAt,
        },
      });
      if (standing.currentCommits !== standing.previousCommits) {
        await prisma.githubUserActivityObservation.create({
          data: {
            githubId: standing.githubId,
            year: YEAR,
            visibility: 'PUBLIC',
            commitCount: standing.currentCommits,
            observedAt: currentAt,
          },
        });
      }
      await prisma.githubUserActivityCycleSnapshot.deleteMany({
        where: { githubId: standing.githubId, year: YEAR },
      });
      await prisma.githubUserActivityCycleSnapshot.create({
        data: {
          githubId: standing.githubId,
          githubLogin: 'stale',
          year: YEAR,
          visibility: 'PUBLIC',
          commitCount: 0,
          observedAt: previousAt,
        },
      });
    }

    const before = await rankingPage.findPage(YEAR, 1, 20, null);
    await runScript(REVERSE_SQL);
    await runScript(REVERSE_SQL);
    const after = await rankingPage.findPage(YEAR, 1, 20, null);
    const restored = await previousRanksFromCycleSnapshot(YEAR);
    for (const login of [`${PREFIX}gamma`, `${PREFIX}alpha`, `${PREFIX}beta`]) {
      const head = after.items.find((item) => item.githubLogin === login);
      const prior = before.items.find((item) => item.githubLogin === login);
      expect(head?.previousRank).toBe(prior?.previousRank);
      expect(head?.rank).toBe(prior?.rank);
      expect(restored.get(login)).toBe(head?.previousRank);
    }

    const applications = await activity.findProgramActivityApplications(
      `${PREFIX}activity-program`,
      null,
    );
    const headCommits = applications[0]?.repository?._count.commits;
    const activityRepository = await prisma.githubRepository.findUniqueOrThrow({
      where: { githubRepositoryId: ACTIVITY_REPO_ID },
    });
    const restoredCommits = await prisma.collectionCommitFact.count({
      where: { repositoryId: activityRepository.id },
    });
    expect(headCommits).toBe(4);
    expect(restoredCommits).toBe(headCommits);
    const headTimeline = await activity.findRepositoryActivity({
      repositoryIds: [ACTIVITY_REPO_ID],
      authorGithubId: GAMMA_ID,
    });
    const restoredTimeline = await prisma.collectionCommitFact.findMany({
      where: {
        repositoryId: activityRepository.id,
        authorGithubId: GAMMA_ID,
      },
      select: { committedAt: true },
    });
    expect(
      restoredTimeline.map((row) => row.committedAt.toISOString()).sort(),
    ).toEqual(
      (headTimeline[0]?.commitDates ?? [])
        .map((date) => date.toISOString())
        .sort(),
    );
  });

  it('restores the later of the ledger and legacy observation times', async () => {
    const year = YEAR - 1;
    const changedAt = new Date('2098-03-01T00:00:00.000Z');
    const seenAt = new Date('2098-04-01T00:00:00.000Z');
    const legacySeenAt = new Date('2098-05-01T00:00:00.000Z');
    await prisma.githubUserActivityObservation.createMany({
      data: [
        {
          githubId: GAMMA_ID,
          year,
          visibility: 'PUBLIC',
          commitCount: 7,
          observedAt: changedAt,
          clockAt: seenAt,
        },
        {
          githubId: ALPHA_ID,
          year,
          visibility: 'PUBLIC',
          commitCount: 7,
          observedAt: changedAt,
        },
      ],
    });
    await prisma.githubUserActivityHistory.create({
      data: {
        githubId: ALPHA_ID,
        githubLogin: `${PREFIX}alpha`,
        year,
        visibility: 'PUBLIC',
        commitCount: 7,
        observedAt: legacySeenAt,
      },
    });

    await runScript(REVERSE_SQL);

    await expect(
      prisma.githubUserActivityHistory.findMany({
        where: { year },
        orderBy: { githubId: 'asc' },
        select: { githubId: true, observedAt: true },
      }),
    ).resolves.toEqual([
      { githubId: GAMMA_ID, observedAt: seenAt },
      { githubId: ALPHA_ID, observedAt: legacySeenAt },
    ]);
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
            CURRENT_TIMESTAMP AS observed_at
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
