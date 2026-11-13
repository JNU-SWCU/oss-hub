import type {
  ContributionKind,
  PrismaClient,
  RepositorySource,
} from '@prisma/client';

export interface DailyContribution {
  readonly githubId: bigint;
  readonly date: string;
  readonly commitCount?: number;
  readonly pullRequestCount?: number;
  readonly releaseCount?: number;
  readonly issueCount?: number;
}

const KIND_COUNTS = [
  ['COMMIT', 'commitCount'],
  ['PULL_REQUEST', 'pullRequestCount'],
  ['RELEASE', 'releaseCount'],
  ['ISSUE', 'issueCount'],
] as const satisfies ReadonlyArray<
  readonly [ContributionKind, keyof DailyContribution]
>;

export async function seedDailyContributions(
  prisma: Pick<PrismaClient, 'repo' | 'contributionEvent'>,
  githubRepositoryId: bigint,
  rows: readonly DailyContribution[],
  source: RepositorySource = 'ORG_PROVISIONED',
): Promise<void> {
  await prisma.repo.upsert({
    where: { githubRepoId: githubRepositoryId },
    create: {
      githubRepoId: githubRepositoryId,
      ownerName: 'synthetic',
      source,
    },
    update: {},
  });
  await prisma.contributionEvent.createMany({
    data: rows.flatMap((row) => {
      const occurredAt = new Date(`${row.date}T03:00:00Z`);
      return KIND_COUNTS.flatMap(([kind, field]) =>
        Array.from({ length: row[field] ?? 0 }, (_, index) => ({
          repoId: githubRepositoryId,
          kind,
          githubKey: `${row.githubId}-${row.date}-${kind}-${index}`,
          authorGithubId: row.githubId,
          occurredAt,
          firstSeenAt: occurredAt,
        })),
      );
    }),
    skipDuplicates: true,
  });
}

export async function setRepoLastSuccessAt(
  prisma: Pick<PrismaClient, 'repo'>,
  githubRepositoryId: bigint,
  lastSuccessAt: Date | null,
  source: RepositorySource = 'ORG_PROVISIONED',
): Promise<void> {
  await prisma.repo.upsert({
    where: { githubRepoId: githubRepositoryId },
    create: {
      githubRepoId: githubRepositoryId,
      ownerName: 'synthetic',
      source,
      lastSuccessAt,
    },
    update: { lastSuccessAt },
  });
}

export async function repositoryContributionTotals(
  prisma: Pick<PrismaClient, '$queryRaw'>,
  repositoryIds: readonly string[],
): Promise<{
  commitCount: number;
  pullRequestCount: number;
  releaseCount: number;
  issueCount: number;
}> {
  const [row] = await prisma.$queryRaw<
    [
      {
        commitCount: number;
        pullRequestCount: number;
        releaseCount: number;
        issueCount: number;
      },
    ]
  >`
    SELECT
      COALESCE(SUM(commit_count), 0)::int AS "commitCount",
      COALESCE(SUM(pull_request_count), 0)::int AS "pullRequestCount",
      COALESCE(SUM(release_count), 0)::int AS "releaseCount",
      COALESCE(SUM(issue_count), 0)::int AS "issueCount"
    FROM repo_contribution
    WHERE repository_id = ANY(${repositoryIds})
  `;
  return row;
}
