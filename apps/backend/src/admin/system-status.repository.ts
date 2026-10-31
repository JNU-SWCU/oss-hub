import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  type CollectionRunKind,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';

export interface SystemStatusActor {
  hasStaffAccess: boolean;
  hasAdminAccess: boolean;
  accountStatus: AccountStatus;
}

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

export interface CollectionSweepActivityDto {
  readonly sweepFinishedAt: Date;
  readonly cycleStartedAt: Date | null;
  readonly scope: string;

  readonly kind: CollectionRunKind;
  readonly insertedCommitCount: number;
  readonly insertedPullRequestCount: number;
  readonly insertedReleaseCount: number;
  readonly insertedIssueCount: number;
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
  readonly cumulativeIssueCount: number;
}

const COLLECTION_TARGET = {
  OR: [{ applicationId: { not: null } }, { programId: null, teamId: null }],
} satisfies Prisma.GithubRepositoryWhereInput;

const PRESENT_REPOSITORY = {
  presence: 'PRESENT',
  source: 'ORG_PROVISIONED',
  ...COLLECTION_TARGET,
} as const;

const PRESENT_EXTERNAL_REPOSITORY = {
  presence: 'PRESENT',
  source: 'EXTERNAL_PUBLIC',
  applicationId: { not: null },
} as const;

const EXTERNAL_SWEEP_SCOPE = 'external';

function toSweepActivity(row: {
  sweepFinishedAt: Date;
  cycleStartedAt: Date | null;
  scope: string;
  kind: CollectionRunKind;
  insertedCommitCount: number;
  insertedPullRequestCount: number;
  insertedReleaseCount: number;
  insertedIssueCount: number;
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
    kind: row.kind,
    insertedCommitCount: row.insertedCommitCount,
    insertedPullRequestCount: row.insertedPullRequestCount,
    insertedReleaseCount: row.insertedReleaseCount,
    insertedIssueCount: row.insertedIssueCount,
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

  countFinalProvisionFailures(): Promise<number> {
    return this.prisma.repositoryProvisionJob.count({
      where: { status: 'FAILED_FINAL' },
    });
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
    const pendingStreamCount = countFor('PENDING');
    const verifyingStreamCount = countFor('VERIFYING');

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

    return repositories.map((repository) => ({
      repositoryName: repository.nameWithOwner,
      programName: programNameById.get(repository.githubRepositoryId) ?? null,
      streams: repository.streams,
    }));
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
          where: { scope: EXTERNAL_SWEEP_SCOPE, kind: 'SWEEP' },
          orderBy: { sweepFinishedAt: 'desc' },
        }),

        this.prisma.collectionSweepHistory.aggregate({
          where: { scope: EXTERNAL_SWEEP_SCOPE },
          _sum: {
            insertedCommitCount: true,
            insertedPullRequestCount: true,
            insertedReleaseCount: true,
            insertedIssueCount: true,
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
      cumulativeIssueCount: sweepTotals._sum.insertedIssueCount ?? 0,
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
