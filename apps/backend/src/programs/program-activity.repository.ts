import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { PlatformRepository } from '../platform/platform.repository';

export interface ProgramRepositoryLink {
  readonly programId: string;
  readonly githubRepositoryId: bigint;
}

export interface ProgramActivitySummaryDataSource {
  readonly githubRepository: {
    findMany(args: {
      readonly where: {
        readonly team: { readonly programId: { readonly in: string[] } };
      };
      readonly select: {
        readonly team: { readonly select: { readonly programId: true } };
        readonly githubRepositoryId: true;
      };
    }): Promise<
      readonly {
        team: { programId: string } | null;
        githubRepositoryId: bigint;
      }[]
    >;
  };
}

@Injectable()
export class ProgramActivitySummaryRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: ProgramActivitySummaryDataSource,
  ) {}

  async findRepositoryLinks(
    programIds: readonly string[],
  ): Promise<readonly ProgramRepositoryLink[]> {
    if (programIds.length === 0) return [];
    const rows = await this.prisma.githubRepository.findMany({
      where: {
        team: { programId: { in: [...programIds] } },
      },
      select: {
        team: { select: { programId: true } },
        githubRepositoryId: true,
      },
    });

    return rows.flatMap((row) =>
      row.team === null
        ? []
        : [
            {
              programId: row.team.programId,
              githubRepositoryId: row.githubRepositoryId,
            },
          ],
    );
  }
}

export interface ProgramRepositoryActivityQuery {
  readonly repositoryIds: readonly bigint[];
  readonly authorGithubId?: bigint;
}

export interface ProgramActivityApplication {
  readonly id: string;
  readonly name: string;
  readonly members: {
    readonly user: { readonly githubId: bigint; readonly nickname: string };
  }[];
  repository: {
    failureCount: number;
    streams: { lastRunAt: Date | null }[];
    _count: {
      commits: number;
      pullRequests: number;
      releases: number;
    };
    commits: { committedAt: Date }[];
    pullRequests: { createdAt: Date }[];
    releases: { publishedAt: Date }[];
    contributions: {
      githubId: bigint;
      commitCount: number;
      pullRequestCount: number;
      releaseCount: number;
    }[];
  } | null;
}

export interface ProgramRepositoryActivity {
  readonly repositoryId: bigint;
  readonly dataAsOf: Date;
  readonly commitDates: readonly Date[];
  readonly pullRequestDates: readonly Date[];
  readonly releaseDates: readonly Date[];
  readonly issueDates: readonly Date[];
}

@Injectable()
export class ProgramActivityRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformRepository: PlatformRepository,
  ) {}

  async findProgramActivityApplications(
    programId: string,
    studentUserId: string | null,
  ): Promise<ProgramActivityApplication[]> {
    const applications = await this.prisma.team.findMany({
      where: {
        programId,
        archivedAt: null,
        AND: [
          {
            OR: [
              {
                repository: {
                  is: this.platformRepository.linkedRepositoryFilter(),
                },
              },
              { status: 'APPROVED', repository: null },
            ],
          },
          ...(studentUserId
            ? [
                this.platformRepository.programApplicationParticipantWhere(
                  studentUserId,
                ),
              ]
            : []),
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        members: {
          orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
          select: { user: { select: { githubId: true, nickname: true } } },
        },
        repository: {
          select: {
            id: true,
            failureCount: true,
            streams: { select: { lastRunAt: true } },
          },
        },
      },
    });
    const summaries = await readRepositorySummaries(
      this.prisma,
      applications.flatMap((application) =>
        application.repository === null ? [] : [application.repository.id],
      ),
    );
    return applications.map((application) => {
      const repository = application.repository;
      if (repository === null) return { ...application, repository: null };
      const summary = summaries.get(repository.id);
      const lastActivityAt = summary?.lastActivityAt ?? null;
      return {
        ...application,
        repository: {
          failureCount: repository.failureCount,
          streams: repository.streams,
          _count: {
            commits: summary?.commitCount ?? 0,
            pullRequests: summary?.pullRequestCount ?? 0,
            releases: summary?.releaseCount ?? 0,
          },
          commits:
            lastActivityAt === null ? [] : [{ committedAt: lastActivityAt }],
          pullRequests: [],
          releases: [],
          contributions: [...(summary?.contributions ?? [])],
        },
      };
    });
  }

  async findRepositoryActivity(
    query: ProgramRepositoryActivityQuery,
  ): Promise<readonly ProgramRepositoryActivity[]> {
    if (query.repositoryIds.length === 0) return [];

    const repositories = await this.prisma.githubRepository.findMany({
      where: {
        githubRepositoryId: { in: [...query.repositoryIds] },
        ...this.platformRepository.linkedRepositoryFilter(),
      },
      select: {
        githubRepositoryId: true,
        updatedAt: true,
        lastCompleteInventoryObservedAt: true,
      },
    });
    const events = await readContributionEvents(
      this.prisma,
      repositories.map((repository) => repository.githubRepositoryId),
      query.authorGithubId,
    );
    return repositories.map((repository) => {
      const matched = events.filter(
        (event) => event.repositoryId === repository.githubRepositoryId,
      );
      return {
        repositoryId: repository.githubRepositoryId,
        dataAsOf:
          repository.lastCompleteInventoryObservedAt ?? repository.updatedAt,
        commitDates: datesFor(matched, 'commit'),
        pullRequestDates: datesFor(matched, 'pull_request'),
        releaseDates: datesFor(matched, 'release'),
        issueDates: datesFor(matched, 'issue'),
      };
    });
  }
}

type ContributionKind = 'commit' | 'pull_request' | 'release' | 'issue';

interface AuthorContributionRow {
  readonly repositoryId: string;
  readonly githubId: bigint;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
}

interface RepositorySummary {
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
  readonly contributions: readonly {
    readonly githubId: bigint;
    readonly commitCount: number;
    readonly pullRequestCount: number;
    readonly releaseCount: number;
  }[];
  readonly lastActivityAt: Date | null;
}

interface ContributionEventRow {
  readonly repositoryId: bigint;
  readonly kind: string;
  readonly occurredAt: Date;
}

const isCount = (value: unknown): value is number => Number.isInteger(value);

const readRepositorySummaries = async (
  prisma: PrismaService,
  repositoryIds: readonly string[],
): Promise<ReadonlyMap<string, RepositorySummary>> => {
  if (repositoryIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<readonly AuthorContributionRow[]>`
    SELECT
      daily.repository_id AS "repositoryId",
      daily.github_id AS "githubId",
      SUM(daily.commit_count)::int AS "commitCount",
      SUM(daily.pull_request_count)::int AS "pullRequestCount",
      SUM(daily.release_count)::int AS "releaseCount"
    FROM repo_contribution AS daily
    WHERE daily.repository_id IN (${Prisma.join(repositoryIds)})
    GROUP BY daily.repository_id, daily.github_id
  `;
  const latest = await prisma.$queryRaw<
    readonly {
      readonly repositoryId: string;
      readonly occurredAt: Date | null;
    }[]
  >`
    SELECT
      repository.id AS "repositoryId",
      MAX(event.occurred_at) AS "occurredAt"
    FROM "contribution" AS event
    JOIN "GithubRepository" AS repository
      ON repository."githubRepositoryId" = event.repo_id
    WHERE repository.id IN (${Prisma.join(repositoryIds)})
      AND event.kind IN (
        'commit'::"contribution_kind",
        'pull_request'::"contribution_kind",
        'release'::"contribution_kind"
      )
    GROUP BY repository.id
  `;
  const lastByRepository = new Map(
    latest.map((row) => [row.repositoryId, row.occurredAt]),
  );
  const summaries = new Map<string, RepositorySummary>();
  for (const row of rows) {
    if (
      typeof row.githubId !== 'bigint' ||
      !isCount(row.commitCount) ||
      !isCount(row.pullRequestCount) ||
      !isCount(row.releaseCount)
    ) {
      throw new Error('Repository contribution summary was not an integer');
    }
    const current = summaries.get(row.repositoryId) ?? {
      commitCount: 0,
      pullRequestCount: 0,
      releaseCount: 0,
      contributions: [],
      lastActivityAt: lastByRepository.get(row.repositoryId) ?? null,
    };
    summaries.set(row.repositoryId, {
      ...current,
      commitCount: current.commitCount + row.commitCount,
      pullRequestCount: current.pullRequestCount + row.pullRequestCount,
      releaseCount: current.releaseCount + row.releaseCount,
      contributions: [
        ...current.contributions,
        {
          githubId: row.githubId,
          commitCount: row.commitCount,
          pullRequestCount: row.pullRequestCount,
          releaseCount: row.releaseCount,
        },
      ],
    });
  }
  for (const [repositoryId, occurredAt] of lastByRepository) {
    if (summaries.has(repositoryId) || occurredAt === null) continue;
    summaries.set(repositoryId, {
      commitCount: 0,
      pullRequestCount: 0,
      releaseCount: 0,
      contributions: [],
      lastActivityAt: occurredAt,
    });
  }
  const anonymous = await prisma.$queryRaw<
    readonly {
      readonly repositoryId: string;
      readonly commitCount: number;
      readonly pullRequestCount: number;
      readonly releaseCount: number;
    }[]
  >`
    SELECT
      repository.id AS "repositoryId",
      COUNT(*) FILTER (WHERE event.kind = 'commit')::int AS "commitCount",
      COUNT(*) FILTER (WHERE event.kind = 'pull_request')::int AS "pullRequestCount",
      COUNT(*) FILTER (WHERE event.kind = 'release')::int AS "releaseCount"
    FROM "contribution" AS event
    JOIN "GithubRepository" AS repository
      ON repository."githubRepositoryId" = event.repo_id
    WHERE repository.id IN (${Prisma.join(repositoryIds)})
      AND event.author_github_id IS NULL
    GROUP BY repository.id
  `;
  for (const row of anonymous) {
    if (
      !isCount(row.commitCount) ||
      !isCount(row.pullRequestCount) ||
      !isCount(row.releaseCount)
    ) {
      throw new Error('Anonymous contribution summary was not an integer');
    }
    const current = summaries.get(row.repositoryId) ?? {
      commitCount: 0,
      pullRequestCount: 0,
      releaseCount: 0,
      contributions: [],
      lastActivityAt: lastByRepository.get(row.repositoryId) ?? null,
    };
    summaries.set(row.repositoryId, {
      ...current,
      commitCount: current.commitCount + row.commitCount,
      pullRequestCount: current.pullRequestCount + row.pullRequestCount,
      releaseCount: current.releaseCount + row.releaseCount,
    });
  }
  return summaries;
};

const readContributionEvents = async (
  prisma: PrismaService,
  repositoryIds: readonly bigint[],
  authorGithubId: bigint | undefined,
): Promise<readonly ContributionEventRow[]> => {
  if (repositoryIds.length === 0) return [];
  const authorSql =
    authorGithubId === undefined
      ? Prisma.empty
      : Prisma.sql`AND event.author_github_id = ${authorGithubId}`;
  const rows = await prisma.$queryRaw<readonly ContributionEventRow[]>`
    SELECT
      event.repo_id AS "repositoryId",
      event.kind::text AS kind,
      event.occurred_at AS "occurredAt"
    FROM "contribution" AS event
    WHERE event.repo_id IN (${Prisma.join(repositoryIds)})
      ${authorSql}
  `;
  return rows.map((row) => {
    if (
      typeof row.repositoryId !== 'bigint' ||
      !(row.occurredAt instanceof Date)
    ) {
      throw new Error('Contribution event row was not a timestamp');
    }
    return row;
  });
};

const datesFor = (
  events: readonly ContributionEventRow[],
  kind: ContributionKind,
): readonly Date[] =>
  events
    .filter((event) => event.kind === kind)
    .map((event) => event.occurredAt);
