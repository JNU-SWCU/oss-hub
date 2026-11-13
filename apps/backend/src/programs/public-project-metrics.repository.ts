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
  readonly inventoryObservedAt: Date | null;
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
    const repositories = await this.prisma.githubRepository.findMany({
      where: {
        githubRepositoryId: { in: [...repositoryIds] },
        visibility: 'PUBLIC',
        presence: 'PRESENT',
        ...this.platformRepository.linkedRepositoryFilter(),
      },
      select: {
        githubRepositoryId: true,
        lastCompleteInventoryObservedAt: true,
      },
    });
    if (repositories.length === 0) return [];
    const rows = await this.readRepoContribution(
      repositories.map((repository) => repository.githubRepositoryId),
    );
    return repositories.map((repository) => ({
      repositoryId: repository.githubRepositoryId,
      inventoryObservedAt: repository.lastCompleteInventoryObservedAt,
      contributions: rows.filter(
        (row) => row.githubRepositoryId === repository.githubRepositoryId,
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
        daily.github_repository_id AS "githubRepositoryId",
        daily.github_id AS "githubId",
        daily.commit_count AS "commitCount",
        daily.pull_request_count AS "pullRequestCount",
        daily.release_count AS "releaseCount",
        daily.updated_at AS "updatedAt"
      FROM repo_contribution AS daily
      JOIN "GithubRepository" AS repository
        ON repository.id = daily.repository_id
      WHERE daily.github_repository_id IN (${Prisma.join([...repositoryIds])})
        AND repository.visibility = 'PUBLIC'::"RepositoryVisibility"
        AND repository.presence = 'PRESENT'::"CollectionRepositoryPresence"
        AND repository."teamId" IS NOT NULL
        AND repository.source IN (
          'ORG_PROVISIONED'::"RepositorySource",
          'EXTERNAL_PUBLIC'::"RepositorySource"
        )
        AND daily.github_id IN (${Prisma.raw(STUDENT_GITHUB_IDS)})
    `;
  }
}

interface RepoContributionSqlRow extends ContributionCountsRow {
  readonly githubRepositoryId: bigint;
  readonly githubId: bigint;
}
