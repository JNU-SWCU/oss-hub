import { Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { PlatformRepository } from '../platform/platform.repository';

export interface CollectionIncrementalStatusSnapshotDto {
  readonly trackedRepositoryCount: number;
  readonly readyStreamCount: number;
  readonly backfillingStreamCount: number;
  readonly pendingStreamCount: number;
  readonly verifyingStreamCount: number;
  readonly retryPendingStreamCount: number;
  readonly oldestReadyCheckpointAt: Date | null;
  readonly latestCheckpointAt: Date | null;
  readonly oldestRetryPendingAt: Date | null;
  readonly lastCycleStartedAt: Date | null;
  readonly lastCycleCompletedAt: Date | null;
  readonly dueRepositoryCount: number;
  readonly failingRepositoryCount: number;
  readonly lastRepositorySuccessAt: Date | null;
}

interface CollectionRepositoryStreamRow {
  readonly streamType: string;
  readonly status: string;
  readonly lastRunAt: Date | null;
  readonly lastErrorCode: string | null;
  readonly lastErrorAt: Date | null;
}

export interface CollectionRepositoryStreamsDto {
  readonly repositoryName: string;
  readonly programName: string | null;
  readonly streams: readonly CollectionRepositoryStreamRow[];
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

  async getIncrementalStatusSnapshot(): Promise<CollectionIncrementalStatusSnapshotDto> {
    const presentRepository = {
      ...PRESENT_REPOSITORY,
      ...this.platform.collectionTargetWhere(),
    };
    const trackedRepositoryCount = await this.prisma.githubRepository.count({
      where: presentRepository,
    });

    const now = new Date();
    const [dueRepositoryCount, failingRepositoryCount, lastSuccess] =
      await Promise.all([
        this.prisma.githubRepository.count({
          where: { ...presentRepository, nextRunAt: { lte: now } },
        }),
        this.prisma.githubRepository.count({
          where: { ...presentRepository, failureCount: { gt: 0 } },
        }),
        this.prisma.githubRepository.aggregate({
          where: presentRepository,
          _max: { lastSuccessAt: true },
        }),
      ]);

    const streamGroups = await this.prisma.collectionRepositoryStream.groupBy({
      by: ['status'],
      where: { repository: presentRepository },
      _count: { _all: true },
    });
    const countFor = (status: string): number =>
      streamGroups.find((group) => group.status === status)?._count._all ?? 0;

    const readyStreamCount = countFor('READY');
    const backfillingStreamCount = countFor('BACKFILLING');
    const pendingStreamCount = countFor('PENDING');
    const verifyingStreamCount = countFor('VERIFYING');

    const retryPendingWhere = {
      lastErrorCode: { not: null },
      repository: presentRepository,
    } as const;
    const retryPendingStreamCount =
      await this.prisma.collectionRepositoryStream.count({
        where: retryPendingWhere,
      });

    const [oldestReady, latest, oldestRetryPending, cursor] = await Promise.all(
      [
        this.prisma.collectionRepositoryStream.aggregate({
          where: { status: 'READY', repository: presentRepository },
          _min: { lastRunAt: true },
        }),
        this.prisma.collectionRepositoryStream.aggregate({
          where: { repository: presentRepository },
          _max: { lastRunAt: true },
        }),
        this.prisma.collectionRepositoryStream.aggregate({
          where: retryPendingWhere,
          _min: { lastErrorAt: true },
        }),
        this.prisma.collectionSyncCursor.findFirst({
          orderBy: { updatedAt: 'desc' },
          select: { cycleStartedAt: true, cycleCompletedAt: true },
        }),
      ],
    );

    return {
      trackedRepositoryCount,
      readyStreamCount,
      backfillingStreamCount,
      pendingStreamCount,
      verifyingStreamCount,
      retryPendingStreamCount,
      oldestReadyCheckpointAt: oldestReady._min.lastRunAt ?? null,
      latestCheckpointAt: latest._max.lastRunAt ?? null,
      oldestRetryPendingAt: oldestRetryPending._min.lastErrorAt ?? null,
      lastCycleStartedAt: cursor?.cycleStartedAt ?? null,
      lastCycleCompletedAt: cursor?.cycleCompletedAt ?? null,
      dueRepositoryCount,
      failingRepositoryCount,
      lastRepositorySuccessAt: lastSuccess._max.lastSuccessAt ?? null,
    };
  }

  async getIncrementalStatusStreams(): Promise<
    readonly CollectionRepositoryStreamsDto[]
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
        streams: {
          select: {
            streamType: true,
            status: true,
            lastRunAt: true,
            lastErrorCode: true,
            lastErrorAt: true,
          },
        },
      },
    });

    const programNameById = await this.resolveProgramNamesByRepositoryId(
      repositories.map((repository) => repository.githubRepositoryId),
    );

    return repositories.map((repository) => ({
      repositoryName: repository.nameWithOwner,
      programName: programNameById.get(repository.githubRepositoryId) ?? null,
      streams: repository.streams,
    }));
  }

  async getExternalCollectionStatus(): Promise<CollectionExternalCollectionStatusDto> {
    const where = {
      ...PRESENT_EXTERNAL_REPOSITORY,
      ...this.platform.collectionTargetWhere(),
    };
    const [trackedRepositoryCount, lastSuccess] = await Promise.all([
      this.prisma.githubRepository.count({ where }),
      this.prisma.githubRepository.aggregate({
        where,
        _max: { lastSuccessAt: true },
      }),
    ]);

    return {
      trackedRepositoryCount,
      lastSuccessAt: lastSuccess._max.lastSuccessAt ?? null,
    };
  }

  private async resolveProgramNamesByRepositoryId(
    githubRepositoryIds: readonly bigint[],
  ): Promise<ReadonlyMap<bigint, string>> {
    if (githubRepositoryIds.length === 0) return new Map();

    const repositories = await this.prisma.githubRepository.findMany({
      where: { githubRepositoryId: { in: [...githubRepositoryIds] } },
      select: {
        githubRepositoryId: true,
        team: { select: { program: { select: { name: true } } } },
      },
    });
    return new Map(
      repositories.flatMap((repository) =>
        repository.team === null
          ? []
          : [[repository.githubRepositoryId, repository.team.program.name]],
      ),
    );
  }
}
