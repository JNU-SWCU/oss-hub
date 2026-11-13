import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { PlatformRepository } from '../platform/platform.repository';

export interface CollectionRepositoryStatusDto {
  readonly repositoryName: string;
  readonly programName: string | null;
  readonly lastSuccessAt: Date | null;
}

export interface CollectionExternalCollectionStatusDto {
  readonly trackedRepositoryCount: number;
  readonly lastSuccessAt: Date | null;
}

const PRESENT_REPOSITORY = {
  presence: 'PRESENT',
  source: 'ORG_PROVISIONED',
} as const;

const PRESENT_EXTERNAL_REPOSITORY = {
  presence: 'PRESENT',
  source: 'EXTERNAL_PUBLIC',
} as const;

@Injectable()
export class SystemStatusRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: PlatformRepository,
  ) {}

  countFinalProvisionFailures(): Promise<number> {
    return this.prisma.repositoryProvisionJob.count({
      where: { status: 'FAILED_FINAL' },
    });
  }

  async hasActiveCollectionRun(now: Date): Promise<boolean> {
    const active = await this.prisma.collectionSyncLease.count({
      where: { expiresAt: { gt: now } },
    });
    return active > 0;
  }

  async getCollectionRepositories(): Promise<
    readonly CollectionRepositoryStatusDto[]
  > {
    const repositories = await this.prisma.githubRepository.findMany({
      where: {
        ...PRESENT_REPOSITORY,
        ...this.platform.collectionTargetWhere(),
      },
      orderBy: { nameWithOwner: 'asc' },
      select: {
        githubRepositoryId: true,
        nameWithOwner: true,
        team: { select: { program: { select: { name: true } } } },
      },
    });
    const lastSuccessAt = await this.lastSuccessAtByRepository(
      repositories.map((repository) => repository.githubRepositoryId),
    );
    return repositories.map((repository) => ({
      repositoryName: repository.nameWithOwner,
      programName: repository.team?.program.name ?? null,
      lastSuccessAt: lastSuccessAt.get(repository.githubRepositoryId) ?? null,
    }));
  }

  async getExternalCollectionStatus(): Promise<CollectionExternalCollectionStatusDto> {
    const where = {
      ...PRESENT_EXTERNAL_REPOSITORY,
      ...this.platform.collectionTargetWhere(),
    };
    const [trackedRepositoryCount, lastSuccessAt] = await Promise.all([
      this.prisma.githubRepository.count({ where }),
      this.lastSuccessAt(where),
    ]);

    return { trackedRepositoryCount, lastSuccessAt };
  }

  private async lastSuccessAtByRepository(
    githubRepositoryIds: readonly bigint[],
  ): Promise<ReadonlyMap<bigint, Date | null>> {
    const rows = await this.prisma.repo.findMany({
      where: { githubRepoId: { in: [...githubRepositoryIds] } },
      select: { githubRepoId: true, lastSuccessAt: true },
    });
    return new Map(rows.map((row) => [row.githubRepoId, row.lastSuccessAt]));
  }

  private async lastSuccessAt(
    where: Prisma.GithubRepositoryWhereInput,
  ): Promise<Date | null> {
    const repositories = await this.prisma.githubRepository.findMany({
      where,
      select: { githubRepositoryId: true },
    });
    const lastSuccess = await this.prisma.repo.aggregate({
      where: {
        githubRepoId: {
          in: repositories.map((repository) => repository.githubRepositoryId),
        },
      },
      _max: { lastSuccessAt: true },
    });
    return lastSuccess._max.lastSuccessAt ?? null;
  }
}
