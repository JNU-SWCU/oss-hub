import { Injectable } from '@nestjs/common';
import {
  AdminHistoryEvent,
  ProgramHistoryEvent,
  Prisma,
  RepositoryProvisionJobStatus,
  TeamHistoryEvent,
} from '@prisma/client';
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

export interface ProvisioningFailedTeamDto {
  readonly teamId: string;
  readonly teamName: string;
  readonly programName: string;
  readonly lastErrorCode: string | null;
  readonly updatedAt: Date;
}

export interface ProvisioningStatusDto {
  readonly pending: number;
  readonly processing: number;
  readonly retryable: number;
  readonly failedFinal: number;
  readonly failedTeams: readonly ProvisioningFailedTeamDto[];
}

export interface MailStatusDto {
  readonly sent7d: number;
  readonly failed7d: number;
  readonly lastSentAt: Date | null;
}

export interface BulkRemovalEventDto {
  readonly actorId: string;
  readonly occurredAt: Date;
}

export interface AdminChangeEventDto {
  readonly userId: string;
  readonly actorId: string | null;
  readonly occurredAt: Date;
}

const LIVE_TEAM_JOB_WHERE = {
  team: { archivedAt: null, program: { lifecycle: { not: 'DELETED' } } },
} satisfies Prisma.RepositoryProvisionJobWhereInput;

@Injectable()
export class SystemStatusRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: PlatformRepository,
  ) {}

  async getProvisioningStatus(): Promise<ProvisioningStatusDto> {
    const [counts, failed] = await Promise.all([
      this.prisma.repositoryProvisionJob.groupBy({
        by: ['status'],
        where: LIVE_TEAM_JOB_WHERE,
        _count: { _all: true },
      }),
      this.prisma.repositoryProvisionJob.findMany({
        where: {
          ...LIVE_TEAM_JOB_WHERE,
          status: RepositoryProvisionJobStatus.FAILED_FINAL,
        },
        orderBy: [{ updatedAt: 'desc' }, { teamId: 'asc' }],
        select: {
          teamId: true,
          lastErrorCode: true,
          updatedAt: true,
          team: { select: { name: true, program: { select: { name: true } } } },
        },
      }),
    ]);
    const count = (status: RepositoryProvisionJobStatus): number =>
      counts.find((row) => row.status === status)?._count._all ?? 0;
    return {
      pending: count(RepositoryProvisionJobStatus.PENDING),
      processing: count(RepositoryProvisionJobStatus.PROCESSING),
      retryable: count(RepositoryProvisionJobStatus.FAILED_RETRYABLE),
      failedFinal: count(RepositoryProvisionJobStatus.FAILED_FINAL),
      failedTeams: failed.map((job) => ({
        teamId: job.teamId,
        teamName: job.team.name,
        programName: job.team.program.name,
        lastErrorCode: job.lastErrorCode,
        updatedAt: job.updatedAt,
      })),
    };
  }

  async getMailStatus(since: Date): Promise<MailStatusDto> {
    const [sent7d, failed7d, last] = await Promise.all([
      this.prisma.notification.count({
        where: { channel: 'EMAIL', status: 'SENT', sentAt: { gte: since } },
      }),
      this.prisma.notification.count({
        where: {
          channel: 'EMAIL',
          status: 'FAILED',
          createdAt: { gte: since },
        },
      }),
      this.prisma.notification.aggregate({
        where: { channel: 'EMAIL', status: 'SENT' },
        _max: { sentAt: true },
      }),
    ]);
    return { sent7d, failed7d, lastSentAt: last._max.sentAt ?? null };
  }

  async findBulkRemovalEvents(
    since: Date,
  ): Promise<readonly BulkRemovalEventDto[]> {
    const [teamEvents, programEvents] = await Promise.all([
      this.prisma.teamHistory.findMany({
        where: {
          event: { in: [TeamHistoryEvent.REJECTED, TeamHistoryEvent.DELETED] },
          actorId: { not: null },
          occurredAt: { gte: since },
        },
        select: { actorId: true, occurredAt: true },
      }),
      this.prisma.programHistory.findMany({
        where: {
          event: ProgramHistoryEvent.DELETED,
          actorId: { not: null },
          occurredAt: { gte: since },
        },
        select: { actorId: true, occurredAt: true },
      }),
    ]);
    return [...teamEvents, ...programEvents].flatMap(
      ({ actorId, occurredAt }) =>
        actorId === null ? [] : [{ actorId, occurredAt }],
    );
  }

  findAdminChangeEvents(since: Date): Promise<readonly AdminChangeEventDto[]> {
    return this.prisma.adminHistory.findMany({
      where: {
        event: { in: [AdminHistoryEvent.GRANTED, AdminHistoryEvent.REVOKED] },
        occurredAt: { gte: since },
      },
      select: { userId: true, actorId: true, occurredAt: true },
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
