import { Injectable } from '@nestjs/common';
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
    const repositories = await this.prisma.repo.findMany({
      where: {
        presence: 'PRESENT',
        source: 'ORG_PROVISIONED',
        ...this.platform.collectionTargetRepoWhere(),
      },
      orderBy: { ownerName: 'asc' },
      select: {
        ownerName: true,
        lastSuccessAt: true,
        teamRepos: {
          where: { validTo: null },
          take: 1,
          select: { team: { select: { program: { select: { name: true } } } } },
        },
      },
    });
    return repositories.map((repository) => ({
      repositoryName: repository.ownerName,
      programName: repository.teamRepos[0]?.team.program.name ?? null,
      lastSuccessAt: repository.lastSuccessAt,
    }));
  }

  async getExternalCollectionStatus(): Promise<CollectionExternalCollectionStatusDto> {
    const tracked = await this.prisma.repo.aggregate({
      where: {
        presence: 'PRESENT',
        source: 'EXTERNAL_PUBLIC',
        ...this.platform.collectionTargetRepoWhere(),
      },
      _count: { _all: true },
      _max: { lastSuccessAt: true },
    });

    return {
      trackedRepositoryCount: tracked._count._all,
      lastSuccessAt: tracked._max.lastSuccessAt ?? null,
    };
  }
}
