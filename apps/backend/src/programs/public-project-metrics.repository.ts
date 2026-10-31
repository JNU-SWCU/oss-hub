import { PlatformRepository } from '../platform/platform.repository';
import { Prisma } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';

export interface ContributionCountsRow {
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

function programLinkedRepositoryFilter(): Prisma.GithubRepositoryWhereInput {
  return {
    AND: [
      PlatformRepository.linkedRepositoryFilter(),
      { OR: [{ programId: { not: null } }, { teamId: { not: null } }] },
    ],
  };
}

@Injectable()
export class PublicProjectMetricsRepository {
  constructor(private readonly prisma: PrismaService) {}

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
        ...PlatformRepository.linkedRepositoryFilter(),
      },
      select: {
        githubRepositoryId: true,
        lastCompleteInventoryObservedAt: true,
        contributions: {
          select: {
            commitCount: true,
            pullRequestCount: true,
            releaseCount: true,
            updatedAt: true,
          },
        },
      },
    });
    return repositories.map((repository) => ({
      repositoryId: repository.githubRepositoryId,
      inventoryObservedAt: repository.lastCompleteInventoryObservedAt,
      contributions: repository.contributions,
    }));
  }

  async findContributorContributionRows(
    repositoryIds: readonly bigint[],
  ): Promise<readonly ContributorContributionRow[]> {
    const rows = await this.prisma.contribution.findMany({
      where: {
        repository: {
          githubRepositoryId: { in: [...repositoryIds] },
          visibility: 'PUBLIC',
          presence: 'PRESENT',
          ...programLinkedRepositoryFilter(),
        },
      },
      select: {
        githubId: true,
        commitCount: true,
        pullRequestCount: true,
        releaseCount: true,
        updatedAt: true,
        repository: { select: { githubRepositoryId: true } },
      },
    });
    return rows.map((row) => ({
      repositoryId: row.repository.githubRepositoryId,
      githubUserId: row.githubId,
      commitCount: row.commitCount,
      pullRequestCount: row.pullRequestCount,
      releaseCount: row.releaseCount,
      updatedAt: row.updatedAt,
    }));
  }
}
