import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import {
  ProgramTeamRepositoryEvidenceRepository,
  type TeamActivityScope,
} from './program-team-repository-evidence.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const AUTHOR_MATCH = 8_970_000_000_011n;
const AUTHOR_EVENTS = 8_970_000_000_013n;
const AUTHOR_BOUNDARY = 8_970_000_000_014n;
const GITHUB_REPOSITORY_ID = 8_970_000_100_001n;

describe('team activity contribution days', () => {
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

  it('counts events per member and Seoul day', async () => {
    await seedRepository();
    const day = new Date('2026-08-01T00:00:00.000Z');
    await prisma.contributionEvent.createMany({
      data: [
        event('match-1', AUTHOR_MATCH, day),
        event('match-2', AUTHOR_MATCH, day),
        event('events-only', AUTHOR_EVENTS, day),
        event('null-author', null, day),
      ],
    });

    const points = await readPoints([AUTHOR_MATCH, AUTHOR_EVENTS]);
    expect(points).toEqual([
      [{ date: '2026-08-01', commitCount: 2 }],
      [{ date: '2026-08-01', commitCount: 1 }],
    ]);
  });

  it('splits the Asia/Seoul year boundary at midnight', async () => {
    await seedRepository();
    await prisma.contributionEvent.createMany({
      data: [
        event(
          'before-midnight',
          AUTHOR_BOUNDARY,
          new Date('2025-12-31T14:59:59.999Z'),
        ),
        event(
          'at-midnight',
          AUTHOR_BOUNDARY,
          new Date('2025-12-31T15:00:00.000Z'),
        ),
      ],
    });

    const [points] = await readPoints([AUTHOR_BOUNDARY]);

    expect(points?.map((point) => point.date)).toEqual([
      '2025-12-31',
      '2026-01-01',
    ]);
  });
});

function event(
  key: string,
  authorGithubId: bigint | null,
  occurredAt: Date,
): {
  repoId: bigint;
  kind: 'COMMIT';
  githubKey: string;
  authorGithubId: bigint | null;
  occurredAt: Date;
  firstSeenAt: Date;
} {
  return {
    repoId: GITHUB_REPOSITORY_ID,
    kind: 'COMMIT',
    githubKey: key,
    authorGithubId,
    occurredAt,
    firstSeenAt: occurredAt,
  };
}

async function seedRepository(): Promise<void> {
  await prisma.repo.create({
    data: {
      githubRepoId: GITHUB_REPOSITORY_ID,
      ownerName: 'synthetic',
      source: 'ORG_PROVISIONED',
      lastSuccessAt: new Date('2026-09-01T00:00:00.000Z'),
    },
  });
}

async function readPoints(
  githubIds: readonly bigint[],
): Promise<readonly { date: string; commitCount: number }[][]> {
  const scope: TeamActivityScope = {
    leaderId: 'synthetic-read-views-leader',
    program: {
      startAt: new Date('2025-11-30T15:00:00.000Z'),
      endAt: new Date('2026-12-31T14:59:59.000Z'),
    },
    members: githubIds.map((githubId) => ({
      userId: `synthetic-read-views-${githubId}`,
      user: { githubId, nickname: `synthetic-${githubId}` },
    })),
    application: {
      id: 'synthetic-read-views-application',
      status: 'APPROVED',
      repository: {
        nameWithOwner: 'synthetic/read-views',
        githubRepositoryId: GITHUB_REPOSITORY_ID,
      },
    },
  };
  const activity = await new ProgramTeamRepositoryEvidenceRepository(
    prisma,
  ).activity(scope, new Date('2026-09-01T00:00:00.000Z'));
  return activity.members.map((member) =>
    member.points.map(({ date, commitCount }) => ({ date, commitCount })),
  );
}

async function purge(): Promise<void> {
  await prisma.contributionEvent.deleteMany({
    where: { repoId: GITHUB_REPOSITORY_ID },
  });
  await prisma.repo.deleteMany({
    where: { githubRepoId: GITHUB_REPOSITORY_ID },
  });
}
