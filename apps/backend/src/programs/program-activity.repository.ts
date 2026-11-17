import { READ_CAP } from '../platform/bounded-read.config';
import { BoundedReadRepository } from '../platform/bounded-read.repository';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { PlatformRepository } from '../platform/platform.repository';
import { STUDENT_GITHUB_IDS } from './program-activity.config';

const boundedReads = new BoundedReadRepository();

export interface ProgramActivitySummaryRow {
  readonly programId: string;
  readonly repositoryCount: number;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
  readonly lastActivityAt: Date | null;
  readonly dataAsOf: Date | null;
}

@Injectable()
export class ProgramActivitySummaryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async summarizePrograms(
    programIds: readonly string[],
  ): Promise<readonly ProgramActivitySummaryRow[]> {
    if (programIds.length === 0) return [];
    return this.prisma.$queryRaw<ProgramActivitySummaryRow[]>`
      WITH links AS (
        SELECT team."programId" AS program_id, link.repo_id
        FROM "team_repo" AS link
        JOIN "Team" AS team ON team."id" = link.team_id
        WHERE link.valid_to IS NULL
          AND team."programId" IN (${Prisma.join(programIds)})
      ),
      activity AS (
        SELECT
          event.repo_id,
          (COUNT(*) FILTER (WHERE event.kind = 'commit'))::int AS commits,
          (COUNT(*) FILTER (WHERE event.kind = 'pull_request'))::int AS pull_requests,
          (COUNT(*) FILTER (WHERE event.kind = 'release'))::int AS releases,
          MAX(event.occurred_at) FILTER (
            WHERE event.kind IN ('commit', 'pull_request', 'release')
          ) AS last_activity_at
        FROM "contribution" AS event
        WHERE event.repo_id IN (SELECT repo_id FROM links)
          AND event.author_github_id IN (${Prisma.raw(STUDENT_GITHUB_IDS)})
        GROUP BY event.repo_id
      )
      SELECT
        links.program_id AS "programId",
        COUNT(*)::int AS "repositoryCount",
        COALESCE(SUM(activity.commits) FILTER (WHERE repo.github_repo_id IS NOT NULL), 0)::int AS "commitCount",
        COALESCE(SUM(activity.pull_requests) FILTER (WHERE repo.github_repo_id IS NOT NULL), 0)::int AS "pullRequestCount",
        COALESCE(SUM(activity.releases) FILTER (WHERE repo.github_repo_id IS NOT NULL), 0)::int AS "releaseCount",
        MAX(activity.last_activity_at) FILTER (WHERE repo.github_repo_id IS NOT NULL) AS "lastActivityAt",
        MAX(repo.last_success_at) AS "dataAsOf"
      FROM links
      LEFT JOIN "repo" AS repo ON repo.github_repo_id = links.repo_id
      LEFT JOIN activity ON activity.repo_id = links.repo_id
      GROUP BY links.program_id
      LIMIT ${programIds.length}
    `;
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
    lastSuccessAt: Date | null;
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
  readonly dataAsOf: Date | null;
  readonly commitDates: readonly Date[];
  readonly pullRequestDates: readonly Date[];
  readonly releaseDates: readonly Date[];
  readonly issueDates: readonly Date[];
}

@Injectable()
export class ProgramActivityRepository {
  private readonly boundedReads = new BoundedReadRepository();

  constructor(
    private readonly prisma: PrismaService,
    private readonly platformRepository: PlatformRepository,
  ) {}

  async findProgramActivityApplications(
    programId: string,
    studentUserId: string | null,
  ): Promise<ProgramActivityApplication[]> {
    const applications = await this.boundedReads.readCapped(
      READ_CAP.teamsPerProgram,
      'Team per program',
      (take) =>
        this.prisma.team
          .findMany({
            take,
            where: {
              programId,
              archivedAt: null,
              AND: [
                {
                  OR: [
                    { teamRepos: { some: { validTo: null } } },
                    {
                      status: 'APPROVED',
                      teamRepos: { none: { validTo: null } },
                    },
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
                take: READ_CAP.membersPerTeam + 1,
                orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
                select: {
                  user: { select: { githubId: true, nickname: true } },
                },
              },
              teamRepos: {
                where: { validTo: null },
                take: 1,
                select: { repoId: true },
              },
            },
          })
          .then((result) =>
            this.boundedReads.assertNestedWithin(
              result,
              { members: READ_CAP.membersPerTeam },
              'Team.findMany',
            ),
          ),
    );
    const repositoryIds = applications.flatMap((application) =>
      application.teamRepos.map((link) => link.repoId),
    );
    const summaries = await readRepositorySummaries(this.prisma, repositoryIds);
    const ledger = await this.prisma.repo.findMany({
      take: repositoryIds.length,
      where: { githubRepoId: { in: repositoryIds } },
      select: { githubRepoId: true, lastSuccessAt: true },
    });
    const lastSuccessAt = new Map(
      ledger.map((row) => [row.githubRepoId, row.lastSuccessAt]),
    );
    return applications.map(({ teamRepos, ...application }) => {
      const repositoryId = teamRepos[0]?.repoId;
      if (repositoryId === undefined)
        return { ...application, repository: null };
      const summary = summaries.get(repositoryId);
      const lastActivityAt = summary?.lastActivityAt ?? null;
      return {
        ...application,
        repository: {
          lastSuccessAt: lastSuccessAt.get(repositoryId) ?? null,
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

    const repositories = await this.prisma.repo.findMany({
      take: query.repositoryIds.length,
      where: {
        githubRepoId: { in: [...query.repositoryIds] },
        ...this.platformRepository.linkedRepoWhere(),
      },
      select: { githubRepoId: true, lastSuccessAt: true },
    });
    const events = await readContributionEvents(
      this.prisma,
      repositories.map((repository) => repository.githubRepoId),
      query.authorGithubId,
    );
    return repositories.map((repository) => {
      const matched = events.filter(
        (event) => event.repositoryId === repository.githubRepoId,
      );
      return {
        repositoryId: repository.githubRepoId,
        dataAsOf: repository.lastSuccessAt,
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
  readonly repositoryId: bigint;
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
  repositoryIds: readonly bigint[],
): Promise<ReadonlyMap<bigint, RepositorySummary>> => {
  if (repositoryIds.length === 0) return new Map();
  const rows = await boundedReads.readCapped(
    READ_CAP.contributionRows,
    'Contribution per repository author',
    (take) =>
      prisma.$queryRaw<readonly AuthorContributionRow[]>`
    SELECT
      event.repo_id AS "repositoryId",
      event.author_github_id AS "githubId",
      COUNT(*) FILTER (WHERE event.kind = 'commit')::int AS "commitCount",
      COUNT(*) FILTER (WHERE event.kind = 'pull_request')::int AS "pullRequestCount",
      COUNT(*) FILTER (WHERE event.kind = 'release')::int AS "releaseCount"
    FROM "contribution" AS event
    WHERE event.repo_id IN (${Prisma.join(repositoryIds)})
      AND event.author_github_id IN (${Prisma.raw(STUDENT_GITHUB_IDS)})
    GROUP BY event.repo_id, event.author_github_id
    LIMIT ${take}
  `,
  );
  const latest = await prisma.$queryRaw<
    readonly {
      readonly repositoryId: bigint;
      readonly occurredAt: Date | null;
    }[]
  >`
    SELECT
      event.repo_id AS "repositoryId",
      MAX(event.occurred_at) AS "occurredAt"
    FROM "contribution" AS event
    WHERE event.repo_id IN (${Prisma.join(repositoryIds)})
      AND event.kind IN (
        'commit'::"contribution_kind",
        'pull_request'::"contribution_kind",
        'release'::"contribution_kind"
      )
      AND event.author_github_id IN (${Prisma.raw(STUDENT_GITHUB_IDS)})
    GROUP BY event.repo_id
    LIMIT ${repositoryIds.length}
  `;
  const lastByRepository = new Map(
    latest.map((row) => [row.repositoryId, row.occurredAt]),
  );
  const summaries = new Map<bigint, RepositorySummary>();
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
  const rows = await boundedReads.readCapped(
    READ_CAP.contributionRows,
    'Contribution events',
    (take) =>
      prisma.$queryRaw<readonly ContributionEventRow[]>`
    SELECT
      event.repo_id AS "repositoryId",
      event.kind::text AS kind,
      event.occurred_at AS "occurredAt"
    FROM "contribution" AS event
    WHERE event.repo_id IN (${Prisma.join(repositoryIds)})
      AND event.author_github_id IN (${Prisma.raw(STUDENT_GITHUB_IDS)})
      ${authorSql}
      LIMIT ${take}
  `,
  );
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
