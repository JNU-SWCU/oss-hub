import { PlatformRepository } from '../platform/platform.repository';
import { Prisma } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { STUDENT_GITHUB_IDS } from './program-activity.config';

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
      where: { githubId: { in: unique } },
      select: { githubId: true, nickname: true },
    });
    return new Map(users.map((user) => [user.githubId, user.nickname]));
  }

  async findRepositoryContributionRows(
    repositoryIds: readonly bigint[],
  ): Promise<readonly RepositoryContributionRows[]> {
    const repositories = await this.prisma.repo.findMany({
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

  private readRepoContribution(
    repositoryIds: readonly bigint[],
  ): Promise<readonly RepoContributionSqlRow[]> {
    return this.prisma.$queryRaw<RepoContributionSqlRow[]>`
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
      WHERE event.repo_id IN (${Prisma.join([...repositoryIds])})
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
    `;
  }
}

interface RepoContributionSqlRow extends ContributionCountsRow {
  readonly githubRepositoryId: bigint;
  readonly githubId: bigint;
}
