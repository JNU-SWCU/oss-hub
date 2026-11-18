import { READ_CAP } from '../platform/bounded-read.config';
import { BoundedReadRepository } from '../platform/bounded-read.repository';
import { ReadCapExceededError } from '../platform/read-cap.error';
import { PlatformRepository } from '../platform/platform.repository';
import { Prisma } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { STUDENT_GITHUB_IDS } from './program-activity.config';

const boundedReads = new BoundedReadRepository();
const CONTRIBUTION_DAYS = 'Public project contribution days';

interface ContributionCountsRow {
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
  readonly updatedAt: Date;
}

export interface RepositoryContributionRows {
  readonly repositoryId: bigint;
  readonly lastSuccessAt: Date | null;
  readonly contributions: readonly ContributionCountsRow[];
}

export interface ContributorContributionRow extends ContributionCountsRow {
  readonly repositoryId: bigint;
  readonly githubUserId: bigint;
}

@Injectable()
export class PublicProjectMetricsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformRepository: PlatformRepository,
  ) {}

  async findGithubLogins(
    githubIds: readonly bigint[],
  ): Promise<ReadonlyMap<bigint, string>> {
    const unique = [...new Set(githubIds)];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      take: unique.length,
      where: { githubId: { in: unique } },
      select: { githubId: true, nickname: true },
    });
    return new Map(users.map((user) => [user.githubId, user.nickname]));
  }

  async findRepositoryContributionRows(
    repositoryIds: readonly bigint[],
  ): Promise<readonly RepositoryContributionRows[]> {
    const repositories = await this.prisma.repo.findMany({
      take: repositoryIds.length,
      where: {
        githubRepoId: { in: [...repositoryIds] },
        visibility: 'PUBLIC',
        presence: 'PRESENT',
        ...this.platformRepository.linkedRepoWhere(),
      },
      select: { githubRepoId: true, lastSuccessAt: true },
    });
    if (repositories.length === 0) return [];
    const githubRepositoryIds = repositories.map(
      (repository) => repository.githubRepoId,
    );
    const rows = await this.readRepoContribution(githubRepositoryIds);
    return repositories.map((repository) => ({
      repositoryId: repository.githubRepoId,
      lastSuccessAt: repository.lastSuccessAt,
      contributions: rows.filter(
        (row) => row.githubRepositoryId === repository.githubRepoId,
      ),
    }));
  }

  async findContributorContributionRows(
    repositoryIds: readonly bigint[],
  ): Promise<readonly ContributorContributionRow[]> {
    if (repositoryIds.length === 0) return [];
    const rows = await this.readRepoContribution(repositoryIds);
    return rows.map((row) => ({
      repositoryId: row.githubRepositoryId,
      githubUserId: row.githubId,
      commitCount: row.commitCount,
      pullRequestCount: row.pullRequestCount,
      releaseCount: row.releaseCount,
      updatedAt: row.updatedAt,
    }));
  }

  async findLandingContributorLogins(
    repositoryIds: readonly bigint[],
  ): Promise<readonly string[]> {
    if (repositoryIds.length === 0) return [];
    const cap = READ_CAP.contributionRows;
    const rows = await this.prisma.$queryRaw<
      readonly {
        readonly overflow: boolean;
        readonly githubLogin: string | null;
      }[]
    >`
      WITH selected AS (
        SELECT unnest(ARRAY[${Prisma.join([...repositoryIds])}]::bigint[]) AS repo_id
      ), days AS MATERIALIZED (
        SELECT daily."githubRepositoryId", daily."githubId", daily."commitCount",
               daily."pullRequestCount", daily."releaseCount"
        FROM selected
        CROSS JOIN LATERAL (
          ${contributionDays(Prisma.sql`event.repo_id = selected.repo_id`, cap + 1)}
        ) AS daily
      ), day_counts AS (
        SELECT "githubRepositoryId", count(*) > ${cap} AS overflow
        FROM days
        GROUP BY "githubRepositoryId"
      ), ranked AS (
        SELECT days."githubRepositoryId", days."githubId", row_number() OVER (
          PARTITION BY days."githubRepositoryId"
          ORDER BY sum(days."commitCount") DESC, days."githubId" ASC
        ) AS position
        FROM days
        JOIN day_counts USING ("githubRepositoryId")
        WHERE NOT day_counts.overflow
        GROUP BY days."githubRepositoryId", days."githubId"
        HAVING sum(days."commitCount"::bigint + days."pullRequestCount" + days."releaseCount") > 0
      )
      SELECT coalesce(day_counts.overflow, false) AS overflow,
             CASE WHEN ranked.position IS NOT NULL THEN coalesce(author.login, '') END AS "githubLogin"
      FROM selected
      LEFT JOIN day_counts ON day_counts."githubRepositoryId" = selected.repo_id
      LEFT JOIN ranked ON ranked."githubRepositoryId" = selected.repo_id AND ranked.position <= 2
      LEFT JOIN "User" AS author ON author."githubId" = ranked."githubId"
      LIMIT ${repositoryIds.length * 2}
    `;
    if (rows.some(({ overflow }) => overflow)) {
      throw new ReadCapExceededError(CONTRIBUTION_DAYS, cap);
    }
    return rows.flatMap(({ githubLogin }) =>
      githubLogin === null ? [] : [githubLogin],
    );
  }

  private readRepoContribution(
    repositoryIds: readonly bigint[],
  ): Promise<readonly RepoContributionSqlRow[]> {
    return boundedReads.readCapped(
      READ_CAP.contributionRows,
      CONTRIBUTION_DAYS,
      (take) => {
        const scope = Prisma.sql`event.repo_id IN (${Prisma.join([...repositoryIds])})`;
        return this.prisma.$queryRaw<RepoContributionSqlRow[]>(
          contributionDays(scope, take),
        );
      },
    );
  }
}

function contributionDays(scope: Prisma.Sql, take: number): Prisma.Sql {
  return Prisma.sql`
      SELECT
        event.repo_id AS "githubRepositoryId",
        event.author_github_id AS "githubId",
        COUNT(*) FILTER (WHERE event.kind = 'commit')::int AS "commitCount",
        COUNT(*) FILTER (WHERE event.kind = 'pull_request')::int AS "pullRequestCount",
        COUNT(*) FILTER (WHERE event.kind = 'release')::int AS "releaseCount",
        MAX(event.first_seen_at) AS "updatedAt"
      FROM "contribution" AS event
      JOIN repo AS repository
        ON repository.github_repo_id = event.repo_id
      WHERE ${scope}
        AND event.author_github_id IN (${Prisma.raw(STUDENT_GITHUB_IDS)})
        AND repository.visibility = 'PUBLIC'::"RepositoryVisibility"
        AND repository.presence = 'PRESENT'::"CollectionRepositoryPresence"
        AND EXISTS (
          SELECT 1
          FROM team_repo AS link
          WHERE link.repo_id = repository.github_repo_id
        )
        AND repository.source IN (
          'ORG_PROVISIONED'::"RepositorySource",
          'EXTERNAL_PUBLIC'::"RepositorySource"
        )
      GROUP BY
        event.repo_id,
        event.author_github_id,
        (event.occurred_at AT TIME ZONE 'Asia/Seoul')::date
      LIMIT ${take}
    `;
}

interface RepoContributionSqlRow extends ContributionCountsRow {
  readonly githubRepositoryId: bigint;
  readonly githubId: bigint;
}
