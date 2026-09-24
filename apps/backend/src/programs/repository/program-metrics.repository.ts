import { Prisma } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export type ProgramRepositoryVisibility = 'PRIVATE' | 'PUBLIC';
export type ProgramRepositoryPresence = 'PRESENT' | 'ABSENT';

export interface ProgramRepositoryMetricsQuery {
  readonly repositoryIds: readonly bigint[];
  readonly year?: number;
}

export interface ProgramRepositoryMetrics {
  readonly repositoryId: bigint;
  readonly year: number;
  readonly dataAsOf: Date;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
  readonly visibility: ProgramRepositoryVisibility;
  readonly presence: ProgramRepositoryPresence;
  readonly visibilityObservedAt: Date | null;
}

export interface ProgramRepositoryCumulativeMetricsQuery {
  readonly repositoryIds: readonly bigint[];
}

export interface ProgramRepositoryCumulativeMetrics {
  readonly repositoryId: bigint;
  readonly dataAsOf: Date;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
  readonly hasCollectedData: boolean;
}

export interface ProgramContributorCumulativeMetricsQuery {
  readonly repositoryIds: readonly bigint[];
}

export interface ProgramContributorCumulativeMetrics {
  readonly repositoryId: bigint;
  readonly githubUserId: bigint;
  readonly githubLogin: string;
  readonly dataAsOf: Date;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
}

function asiaSeoulYear(at: Date): number {
  return new Date(at.getTime() + 9 * 60 * 60 * 1000).getUTCFullYear();
}

const seoulYearBoundsUtcForRead = (year: number): readonly [Date, Date] => [
  new Date(Date.UTC(year, 0, 1) - 9 * 60 * 60 * 1000),
  new Date(Date.UTC(year + 1, 0, 1) - 9 * 60 * 60 * 1000),
];

function linkedRepositoryFilter(): Prisma.GithubRepositoryWhereInput {
  return {
    OR: [
      { source: 'ORG_PROVISIONED' },
      { source: 'EXTERNAL_PUBLIC', applicationId: { not: null } },
    ],
  };
}

function programLinkedRepositoryFilter(): Prisma.GithubRepositoryWhereInput {
  return {
    AND: [
      linkedRepositoryFilter(),
      { OR: [{ programId: { not: null } }, { teamId: { not: null } }] },
    ],
  };
}

@Injectable()
export class ProgramMetricsRepository {
  constructor(private readonly prisma: PrismaService) {}

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

  async getRepositoryMetrics(
    query: ProgramRepositoryMetricsQuery,
  ): Promise<readonly ProgramRepositoryMetrics[]> {
    if (query.repositoryIds.length === 0) return [];
    const year = query.year ?? asiaSeoulYear(new Date());
    const [yearStart, yearEnd] = seoulYearBoundsUtcForRead(year);

    const repositories = await this.prisma.githubRepository.findMany({
      where: {
        githubRepositoryId: { in: [...query.repositoryIds] },
        ...linkedRepositoryFilter(),
      },
      select: {
        githubRepositoryId: true,
        visibility: true,
        presence: true,
        lastCompleteInventoryObservedAt: true,
        contributions: {
          where: { date: { gte: yearStart, lt: yearEnd } },
          select: {
            commitCount: true,
            pullRequestCount: true,
            releaseCount: true,
            updatedAt: true,
          },
        },
      },
    });

    return repositories.map((repository) => {
      const folded = repository.contributions.reduce(
        (accumulator, row) => ({
          commitCount: accumulator.commitCount + row.commitCount,
          pullRequestCount: accumulator.pullRequestCount + row.pullRequestCount,
          releaseCount: accumulator.releaseCount + row.releaseCount,
          dataAsOf:
            accumulator.dataAsOf === null ||
            row.updatedAt > accumulator.dataAsOf
              ? row.updatedAt
              : accumulator.dataAsOf,
        }),
        {
          commitCount: 0,
          pullRequestCount: 0,
          releaseCount: 0,
          dataAsOf: null as Date | null,
        },
      );
      return {
        repositoryId: repository.githubRepositoryId,
        year,
        dataAsOf:
          folded.dataAsOf ??
          repository.lastCompleteInventoryObservedAt ??
          new Date(),
        commitCount: folded.commitCount,
        pullRequestCount: folded.pullRequestCount,
        releaseCount: folded.releaseCount,
        visibility: repository.visibility,
        presence: repository.presence,
        visibilityObservedAt: repository.lastCompleteInventoryObservedAt,
      };
    });
  }

  async getRepositoryCumulativeMetrics(
    query: ProgramRepositoryCumulativeMetricsQuery,
  ): Promise<readonly ProgramRepositoryCumulativeMetrics[]> {
    if (query.repositoryIds.length === 0) return [];

    const repositories = await this.prisma.githubRepository.findMany({
      where: {
        githubRepositoryId: { in: [...query.repositoryIds] },
        visibility: 'PUBLIC',
        presence: 'PRESENT',
        ...linkedRepositoryFilter(),
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

    return repositories.map((repository) => {
      const dataAsOf = repository.contributions.reduce<Date | null>(
        (latest, aggregate) =>
          latest === null || aggregate.updatedAt > latest
            ? aggregate.updatedAt
            : latest,
        null,
      );
      return {
        repositoryId: repository.githubRepositoryId,
        dataAsOf:
          dataAsOf ?? repository.lastCompleteInventoryObservedAt ?? new Date(),
        hasCollectedData: repository.lastCompleteInventoryObservedAt !== null,
        commitCount: repository.contributions.reduce(
          (sum, aggregate) => sum + aggregate.commitCount,
          0,
        ),
        pullRequestCount: repository.contributions.reduce(
          (sum, aggregate) => sum + aggregate.pullRequestCount,
          0,
        ),
        releaseCount: repository.contributions.reduce(
          (sum, aggregate) => sum + aggregate.releaseCount,
          0,
        ),
      };
    });
  }

  async getContributorCumulativeMetrics(
    query: ProgramContributorCumulativeMetricsQuery,
  ): Promise<readonly ProgramContributorCumulativeMetrics[]> {
    if (query.repositoryIds.length === 0) return [];

    const rows = await this.prisma.contribution.findMany({
      where: {
        repository: {
          githubRepositoryId: { in: [...query.repositoryIds] },
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

    const byContributor = new Map<
      string,
      {
        repositoryId: bigint;
        githubUserId: bigint;
        githubLogin: string;
        dataAsOf: Date;
        commitCount: number;
        pullRequestCount: number;
        releaseCount: number;
      }
    >();
    for (const row of rows) {
      const key = `${row.repository.githubRepositoryId.toString()}:${row.githubId.toString()}`;
      const current = byContributor.get(key);
      byContributor.set(key, {
        repositoryId: row.repository.githubRepositoryId,
        githubUserId: row.githubId,
        githubLogin: '',
        dataAsOf:
          current === undefined || row.updatedAt > current.dataAsOf
            ? row.updatedAt
            : current.dataAsOf,
        commitCount: (current?.commitCount ?? 0) + row.commitCount,
        pullRequestCount:
          (current?.pullRequestCount ?? 0) + row.pullRequestCount,
        releaseCount: (current?.releaseCount ?? 0) + row.releaseCount,
      });
    }

    // Issue만 연 날은 세 칸이 모두 0인 행을 남긴다(#1133). 이 목록은 issue 수를 보이지
    // 않으므로 합계가 0인 기여자를 "커밋 0 · PR 0 · 릴리스 0"으로 세우지 않는다.
    const contributors = [...byContributor.values()].filter(
      (entry) =>
        entry.commitCount + entry.pullRequestCount + entry.releaseCount > 0,
    );
    const logins = await this.resolveGithubLogins(
      contributors.map((entry) => entry.githubUserId),
    );
    return contributors.map((entry) => ({
      ...entry,
      githubLogin: logins.get(entry.githubUserId) ?? '',
    }));
  }
}
