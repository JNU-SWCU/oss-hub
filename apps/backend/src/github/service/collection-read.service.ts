import { Prisma } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { asiaSeoulYear } from '../repository/collection-incremental.repository';
import type {
  CollectionContributorMetricsDto,
  CollectionContributorMetricsQueryDto,
} from '../collection-read.types';

const seoulYearBoundsUtcForRead = (year: number): readonly [Date, Date] => [
  new Date(Date.UTC(year, 0, 1) - 9 * 60 * 60 * 1000),
  new Date(Date.UTC(year + 1, 0, 1) - 9 * 60 * 60 * 1000),
];

@Injectable()
export class CollectionReadService {
  constructor(private readonly prisma: PrismaService) {}

  private linkedRepositoryFilter(): Prisma.GithubRepositoryWhereInput {
    return {
      OR: [
        { source: 'ORG_PROVISIONED' },
        { source: 'EXTERNAL_PUBLIC', applicationId: { not: null } },
      ],
    };
  }

  private programLinkedRepositoryFilter(): Prisma.GithubRepositoryWhereInput {
    return {
      AND: [
        this.linkedRepositoryFilter(),
        { OR: [{ programId: { not: null } }, { teamId: { not: null } }] },
      ],
    };
  }

  private async resolveGithubLogins(
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

  async getContributorMetrics(
    query: CollectionContributorMetricsQueryDto,
  ): Promise<readonly CollectionContributorMetricsDto[]> {
    if (query.repositoryIds.length === 0) return [];
    const year = query.year ?? asiaSeoulYear(new Date());
    const [yearStart, yearEnd] = seoulYearBoundsUtcForRead(year);

    const rows = await this.prisma.contribution.findMany({
      where: {
        date: { gte: yearStart, lt: yearEnd },
        repository: {
          githubRepositoryId: { in: [...query.repositoryIds] },
          ...this.programLinkedRepositoryFilter(),
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

    const folded = new Map<
      string,
      {
        repositoryId: bigint;
        githubId: bigint;
        dataAsOf: Date;
        commitCount: number;
        pullRequestCount: number;
        releaseCount: number;
      }
    >();
    for (const row of rows) {
      const key = `${row.repository.githubRepositoryId}:${row.githubId}`;
      const current = folded.get(key);
      if (current === undefined) {
        folded.set(key, {
          repositoryId: row.repository.githubRepositoryId,
          githubId: row.githubId,
          dataAsOf: row.updatedAt,
          commitCount: row.commitCount,
          pullRequestCount: row.pullRequestCount,
          releaseCount: row.releaseCount,
        });
        continue;
      }
      current.commitCount += row.commitCount;
      current.pullRequestCount += row.pullRequestCount;
      current.releaseCount += row.releaseCount;
      if (row.updatedAt > current.dataAsOf) current.dataAsOf = row.updatedAt;
    }

    const logins = await this.resolveGithubLogins(
      [...folded.values()].map((entry) => entry.githubId),
    );

    return [...folded.values()].map((entry) => ({
      repositoryId: entry.repositoryId,
      githubUserId: entry.githubId,
      githubLogin: logins.get(entry.githubId) ?? '',
      year,
      dataAsOf: entry.dataAsOf,
      commitCount: entry.commitCount,
      pullRequestCount: entry.pullRequestCount,
      releaseCount: entry.releaseCount,
    }));
  }
}
