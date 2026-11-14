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
  githubRepositoryIds: readonly bigint[],
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
      COUNT(*) FILTER (WHERE event.kind = 'commit')::int AS "commitCount",
      COUNT(*) FILTER (WHERE event.kind = 'pull_request')::int AS "pullRequestCount",
      COUNT(*) FILTER (WHERE event.kind = 'release')::int AS "releaseCount",
      COUNT(*) FILTER (WHERE event.kind = 'issue')::int AS "issueCount"
    FROM "contribution" AS event
    WHERE event.repo_id = ANY(${[...githubRepositoryIds]})
      AND event.author_github_id IS NOT NULL
  `;
  return row;
}
