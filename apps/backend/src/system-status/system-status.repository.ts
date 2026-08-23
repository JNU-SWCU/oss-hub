import { Injectable } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { nextScheduledCollectionAt } from '../github/collection-schedule';
import { PrismaService } from '../prisma/prisma.service';

export interface SystemStatusActor {
  hasStaffAccess: boolean;
  hasAdminAccess: boolean;
  accountStatus: AccountStatus;
}

const COLLECTION_STREAM_TYPES = ['COMMIT', 'PULL_REQUEST', 'RELEASE'] as const;
type CollectionStreamType = (typeof COLLECTION_STREAM_TYPES)[number];
type CollectionStreamStatus = 'PENDING' | 'BACKFILLING' | 'READY' | 'VERIFYING';

export const COLLECTION_STREAM_DETAIL_BUCKETS = [
  'READY',
  'BACKFILLING',
  'PARTIAL',
  'RETRY_PENDING',
] as const;
export type CollectionStreamDetailBucketDto =
  (typeof COLLECTION_STREAM_DETAIL_BUCKETS)[number];

export interface CollectionIncrementalStatusSnapshotDto {
  readonly trackedRepositoryCount: number;
  readonly readyStreamCount: number;
  readonly backfillingStreamCount: number;
  readonly partialStreamCount: number;
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

export interface CollectionRepositoryStreamDetailDto {
  readonly streamType: CollectionStreamType;
  readonly bucket: CollectionStreamDetailBucketDto;
  readonly lastSuccessAt: Date | null;
  readonly lastErrorCode: string | null;
  readonly lastErrorAt: Date | null;
}

export interface CollectionRepositoryStreamsDto {
  readonly repositoryName: string;
  readonly programName: string | null;
  readonly streams: readonly CollectionRepositoryStreamDetailDto[];
}

export interface CollectionSweepActivityDto {
  readonly sweepFinishedAt: Date;
  readonly cycleStartedAt: Date | null;
  readonly scope: string;
  readonly insertedCommitCount: number;
  readonly insertedPullRequestCount: number;
  readonly insertedReleaseCount: number;
  readonly attemptedRepositoryCount: number;
  readonly processedRepositoryCount: number;
  readonly failedRepositoryCount: number;
  readonly cycleCompleted: boolean;
  readonly stoppedForBudget: boolean;
}

export interface CollectionExternalCollectionStatusDto {
  readonly trackedRepositoryCount: number;
  readonly lastSweep: CollectionSweepActivityDto | null;
  readonly cumulativeCommitCount: number;
  readonly cumulativePullRequestCount: number;
  readonly cumulativeReleaseCount: number;
}

const PRESENT_REPOSITORY = {
  presence: 'PRESENT',
  source: 'ORG_PROVISIONED',
} as const;

const PRESENT_EXTERNAL_REPOSITORY = {
  presence: 'PRESENT',
  source: 'EXTERNAL_PUBLIC',
} as const;

const EXTERNAL_SWEEP_SCOPE = 'external';

function classifyStreamBucket(
  status: CollectionStreamStatus | null,
  lastErrorCode: string | null,
): CollectionStreamDetailBucketDto {
  if (lastErrorCode !== null) return 'RETRY_PENDING';
  if (status === 'READY') return 'READY';
  if (status === 'BACKFILLING') return 'BACKFILLING';
  return 'PARTIAL';
}

function toSweepActivity(row: {
  sweepFinishedAt: Date;
  cycleStartedAt: Date | null;
  scope: string;
  insertedCommitCount: number;
  insertedPullRequestCount: number;
  insertedReleaseCount: number;
  attemptedRepositoryCount: number;
  processedRepositoryCount: number;
  failedRepositoryCount: number;
  cycleCompleted: boolean;
  stoppedForBudget: boolean;
}): CollectionSweepActivityDto {
  return {
    sweepFinishedAt: row.sweepFinishedAt,
    cycleStartedAt: row.cycleStartedAt,
    scope: row.scope,
    insertedCommitCount: row.insertedCommitCount,
    insertedPullRequestCount: row.insertedPullRequestCount,
    insertedReleaseCount: row.insertedReleaseCount,
    attemptedRepositoryCount: row.attemptedRepositoryCount,
    processedRepositoryCount: row.processedRepositoryCount,
    failedRepositoryCount: row.failedRepositoryCount,
    cycleCompleted: row.cycleCompleted,
    stoppedForBudget: row.stoppedForBudget,
  };
}

@Injectable()
export class SystemStatusRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActor(githubId: bigint): Promise<SystemStatusActor | null> {
    return this.prisma.user.findUnique({
      where: { githubId },
      select: {
        hasStaffAccess: true,
        hasAdminAccess: true,
        accountStatus: true,
      },
    });
  }

  countFinalProvisionFailures(): Promise<number> {
    return this.prisma.repositoryProvisionJob.count({
      where: { status: 'FAILED_FINAL' },
    });
  }

  findNextCycleAt(from: Date): Date | null {
    return nextScheduledCollectionAt(from);
  }

  async getIncrementalStatusSnapshot(): Promise<CollectionIncrementalStatusSnapshotDto> {
    const trackedRepositoryCount = await this.prisma.githubRepository.count({
      where: PRESENT_REPOSITORY,
    });

    const now = new Date();
    const [dueRepositoryCount, failingRepositoryCount, lastSuccess] =
      await Promise.all([
        this.prisma.githubRepository.count({
          where: { ...PRESENT_REPOSITORY, nextRunAt: { lte: now } },
        }),
        this.prisma.githubRepository.count({
          where: { ...PRESENT_REPOSITORY, failureCount: { gt: 0 } },
        }),
        this.prisma.githubRepository.aggregate({
          where: PRESENT_REPOSITORY,
          _max: { lastSuccessAt: true },
        }),
      ]);

    const streamGroups = await this.prisma.collectionRepositoryStream.groupBy({
      by: ['status'],
      where: { repository: PRESENT_REPOSITORY },
      _count: { _all: true },
    });
    const countFor = (status: string): number =>
      streamGroups.find((group) => group.status === status)?._count._all ?? 0;

    const readyStreamCount = countFor('READY');
    const backfillingStreamCount = countFor('BACKFILLING');
    const knownPartialStreamCount = countFor('PENDING') + countFor('VERIFYING');
    const expectedStreamCount = trackedRepositoryCount * 3;
    const observedStreamCount =
      readyStreamCount + backfillingStreamCount + knownPartialStreamCount;
    const partialStreamCount =
      knownPartialStreamCount +
      Math.max(0, expectedStreamCount - observedStreamCount);

    const retryPendingWhere = {
      lastErrorCode: { not: null },
      repository: PRESENT_REPOSITORY,
    } as const;
    const retryPendingStreamCount =
      await this.prisma.collectionRepositoryStream.count({
        where: retryPendingWhere,
      });

    const [oldestReady, latest, oldestRetryPending, cursor] = await Promise.all(
      [
        this.prisma.collectionRepositoryStream.aggregate({
          where: { status: 'READY', repository: PRESENT_REPOSITORY },
          _min: { lastRunAt: true },
        }),
        this.prisma.collectionRepositoryStream.aggregate({
          where: { repository: PRESENT_REPOSITORY },
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
      partialStreamCount,
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
      where: PRESENT_REPOSITORY,
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

    return repositories.map((repository) => {
      const byType = new Map(
        repository.streams.map((stream) => [stream.streamType, stream]),
      );
      const streams: CollectionRepositoryStreamDetailDto[] =
        COLLECTION_STREAM_TYPES.map((streamType) => {
          const row = byType.get(streamType);
          return {
            streamType,
            bucket: classifyStreamBucket(
              row?.status ?? null,
              row?.lastErrorCode ?? null,
            ),
            lastSuccessAt: row?.lastRunAt ?? null,
            lastErrorCode: row?.lastErrorCode ?? null,
            lastErrorAt: row?.lastErrorAt ?? null,
          };
        });
      return {
        repositoryName: repository.nameWithOwner,
        programName: programNameById.get(repository.githubRepositoryId) ?? null,
        streams,
      };
    });
  }

  async getRecentSweepActivity(
    limit: number,
  ): Promise<readonly CollectionSweepActivityDto[]> {
    const rows = await this.prisma.collectionSweepHistory.findMany({
      orderBy: { sweepFinishedAt: 'desc' },
      take: limit,
    });
    return rows.map((row) => toSweepActivity(row));
  }

  async getExternalCollectionStatus(): Promise<CollectionExternalCollectionStatusDto> {
    const [trackedRepositoryCount, lastSweepRow, sweepTotals] =
      await Promise.all([
        this.prisma.githubRepository.count({
          where: PRESENT_EXTERNAL_REPOSITORY,
        }),
        this.prisma.collectionSweepHistory.findFirst({
          where: { scope: EXTERNAL_SWEEP_SCOPE },
          orderBy: { sweepFinishedAt: 'desc' },
        }),
        this.prisma.collectionSweepHistory.aggregate({
          where: { scope: EXTERNAL_SWEEP_SCOPE },
          _sum: {
            insertedCommitCount: true,
            insertedPullRequestCount: true,
            insertedReleaseCount: true,
          },
        }),
      ]);

    return {
      trackedRepositoryCount,
      lastSweep: lastSweepRow ? toSweepActivity(lastSweepRow) : null,
      cumulativeCommitCount: sweepTotals._sum.insertedCommitCount ?? 0,
      cumulativePullRequestCount:
        sweepTotals._sum.insertedPullRequestCount ?? 0,
      cumulativeReleaseCount: sweepTotals._sum.insertedReleaseCount ?? 0,
    };
  }

  private async resolveProgramNamesByRepositoryId(
    githubRepositoryIds: readonly bigint[],
  ): Promise<ReadonlyMap<bigint, string>> {
    if (githubRepositoryIds.length === 0) return new Map();

    const repositories = await this.prisma.githubRepository.findMany({
      where: { githubRepositoryId: { in: [...githubRepositoryIds] } },
      select: { githubRepositoryId: true, programId: true },
    });
    const programIds = [
      ...new Set(
        repositories
          .map((repository) => repository.programId)
          .filter((programId): programId is string => programId !== null),
      ),
    ];
    if (programIds.length === 0) return new Map();

    const programs = await this.prisma.program.findMany({
      where: { id: { in: programIds } },
      select: { id: true, name: true },
    });
    const nameByProgramId = new Map(
      programs.map((program) => [program.id, program.name]),
    );

    const programNameById = new Map<bigint, string>();
    for (const repository of repositories) {
      const name =
        repository.programId === null
          ? undefined
          : nameByProgramId.get(repository.programId);
      if (name !== undefined) {
        programNameById.set(repository.githubRepositoryId, name);
      }
    }
    return programNameById;
  }
}
