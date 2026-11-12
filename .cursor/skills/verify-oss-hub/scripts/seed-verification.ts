import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient, type ActivityVisibility } from '@prisma/client';

interface RankingFixture {
  readonly id: string;
  readonly nickname: string;
  readonly githubId: string;
  readonly year: number;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
}

interface ContributionFixture {
  readonly userId: string;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
}

interface VerificationFixture {
  readonly ranking: readonly RankingFixture[];
  readonly repository: {
    readonly id: string;
    readonly githubRepositoryId: string;
    readonly nameWithOwner: string;
    readonly teamId: string;
    readonly programId: string;
  };
  readonly contributions: readonly ContributionFixture[];
  readonly staffUserId: string;
}

const OBSERVED_AT = new Date('2026-11-01T00:00:00.000Z');
const VISIBILITY: ActivityVisibility = 'PUBLIC';

function assertLocalVerificationDatabase(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (
    (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') ||
    (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') ||
    database !== 'oss_hub_verify'
  ) {
    throw new Error(
      'verification scaffold refuses a database other than oss_hub_verify on 127.0.0.1',
    );
  }
}

function readFixture(): VerificationFixture {
  const raw = readFileSync(
    join(__dirname, 'verification-fixtures.json'),
    'utf8',
  );
  return JSON.parse(raw) as VerificationFixture;
}

function seoulCalendarDate(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

function assertStaffReady(
  staff: {
    readonly type: string;
    readonly approvalStatus: string;
    readonly profileCreatedAt: Date | null;
    readonly name: string | null;
    readonly department: string | null;
  } | null,
): void {
  if (
    staff === null ||
    staff.type !== 'STAFF' ||
    staff.approvalStatus !== 'APPROVED' ||
    staff.profileCreatedAt === null ||
    staff.name === null ||
    staff.department === null
  ) {
    throw new Error(
      'demo staff user is not an approved staff profile, so team management cannot be driven',
    );
  }
}

async function replaceRankingRows(
  prisma: PrismaClient,
  ranking: readonly RankingFixture[],
): Promise<void> {
  const githubIds = ranking.map((row) => BigInt(row.githubId));
  await prisma.githubUserActivityHistory.deleteMany({
    where: { githubId: { in: githubIds } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: ranking.map((row) => row.id) } },
  });
  for (const row of ranking) {
    await prisma.user.create({
      data: {
        id: row.id,
        githubId: BigInt(row.githubId),
        nickname: row.nickname,
        type: 'STUDENT',
        accountStatus: 'ACTIVE',
        approvalStatus: 'NOT_REQUIRED',
      },
    });
    await prisma.githubUserActivityHistory.create({
      data: {
        githubId: BigInt(row.githubId),
        githubLogin: row.nickname,
        year: row.year,
        visibility: VISIBILITY,
        commitCount: row.commitCount,
        pullRequestCount: row.pullRequestCount,
        issueCount: row.issueCount,
        repositoryCount: row.repositoryCount,
        starCount: row.starCount,
        observedAt: OBSERVED_AT,
      },
    });
  }
}

async function replaceTeamRepository(
  prisma: PrismaClient,
  fixture: VerificationFixture,
): Promise<string> {
  const program = await prisma.program.findUnique({
    where: { id: fixture.repository.programId },
    select: { startAt: true, endAt: true },
  });
  if (program === null) {
    throw new Error('demo internship program is missing');
  }
  const activityDate = new Date(
    `${seoulCalendarDate(program.startAt)}T00:00:00.000Z`,
  );
  if (activityDate.getTime() > program.endAt.getTime()) {
    throw new Error('verification activity date falls outside the program');
  }
  await prisma.contribution.deleteMany({
    where: { repositoryId: fixture.repository.id },
  });
  await prisma.githubRepository.deleteMany({
    where: { id: fixture.repository.id },
  });
  await prisma.githubRepository.create({
    data: {
      id: fixture.repository.id,
      teamId: fixture.repository.teamId,
      githubRepositoryId: BigInt(fixture.repository.githubRepositoryId),
      nameWithOwner: fixture.repository.nameWithOwner,
      defaultBranch: 'main',
      source: 'ORG_PROVISIONED',
      lastSuccessAt: OBSERVED_AT,
      failureCount: 0,
    },
  });
  for (const row of fixture.contributions) {
    const user = await prisma.user.findUnique({
      where: { id: row.userId },
      select: { githubId: true },
    });
    if (user === null) {
      throw new Error(`team member ${row.userId} is missing`);
    }
    await prisma.contribution.create({
      data: {
        repositoryId: fixture.repository.id,
        githubId: user.githubId,
        date: activityDate,
        commitCount: row.commitCount,
        pullRequestCount: row.pullRequestCount,
        issueCount: row.issueCount,
      },
    });
  }
  return activityDate.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error('DATABASE_URL is required');
  }
  assertLocalVerificationDatabase(databaseUrl);
  const fixture = readFixture();
  const prisma = new PrismaClient();
  await prisma.$connect();
  try {
    const staff = await prisma.user.findUnique({
      where: { id: fixture.staffUserId },
      select: {
        type: true,
        approvalStatus: true,
        profileCreatedAt: true,
        name: true,
        department: true,
      },
    });
    assertStaffReady(staff);
    await replaceRankingRows(prisma, fixture.ranking);
    const activityDate = await replaceTeamRepository(prisma, fixture);
    process.stdout.write(
      `${JSON.stringify({
        ranking: fixture.ranking.map((row) => row.nickname),
        staffUserId: fixture.staffUserId,
        repositoryId: fixture.repository.id,
        activityDate,
      })}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
