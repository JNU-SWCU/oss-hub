import { linkedRepositoryFilter } from '../../../../prisma/linked-program-repository';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';

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

function asiaSeoulYear(at: Date): number {
  return new Date(at.getTime() + 9 * 60 * 60 * 1000).getUTCFullYear();
}

const seoulYearBoundsUtcForRead = (year: number): readonly [Date, Date] => [
  new Date(Date.UTC(year, 0, 1) - 9 * 60 * 60 * 1000),
  new Date(Date.UTC(year + 1, 0, 1) - 9 * 60 * 60 * 1000),
];

@Injectable()
export class PublicEligibilityRepository {
  constructor(private readonly prisma: PrismaService) {}

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
}
