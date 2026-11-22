import { BoundedReadRepository } from '../platform/bounded-read.repository';
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

export interface CollectionRepositorySummaryDto {
  readonly trackedRepositoryCount: number;
  readonly staleRepositoryCount: number;
  readonly lastSuccessAt: Date | null;
}

export interface CollectionRepositoryStatusDto {
  readonly repositoryName: string;
  readonly teamName: string | null;
  readonly programName: string | null;
  readonly lastSuccessAt: Date | null;
}

export interface CollectionExternalCollectionStatusDto {
  readonly trackedRepositoryCount: number;
  readonly lastSuccessAt: Date | null;
}

interface ProvisioningFailedTeamDto {
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
  readonly failedTeamsHasMore: boolean;
}

export interface MailStatusDto {
  readonly sent7d: number;
  readonly failed7d: number;
  readonly unknown7d: number;
  readonly lastSentAt: Date | null;
}

export interface BulkRemovalEventDto {
  readonly actorId: string;
  readonly occurredAt: Date;
}

export interface AdminChangeEventDto {
  readonly userId: string;
  readonly login: string;
  readonly actorId: string | null;
  readonly occurredAt: Date;
}

const LIVE_TEAM_JOB_WHERE = {
  team: { archivedAt: null, program: { lifecycle: { not: 'DELETED' } } },
} satisfies Prisma.RepositoryProvisionJobWhereInput;

const FAILED_TEAMS_SHOWN = 100;

@Injectable()
export class SystemStatusRepository {
  private readonly boundedReads = new BoundedReadRepository();

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
        orderBy: { status: 'asc' },
        take: Object.keys(RepositoryProvisionJobStatus).length,
      }),
      this.prisma.repositoryProvisionJob.findMany({
        take: FAILED_TEAMS_SHOWN + 1,
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
      failedTeamsHasMore: failed.length > FAILED_TEAMS_SHOWN,
      failedTeams: failed.slice(0, FAILED_TEAMS_SHOWN).map((job) => ({
        teamId: job.teamId,
        teamName: job.team.name,
        programName: job.team.program.name,
        lastErrorCode: job.lastErrorCode,
        updatedAt: job.updatedAt,
      })),
    };
  }

  async getMailStatus(since: Date): Promise<MailStatusDto> {
    const [result] = await this.prisma.$queryRaw<[MailStatusDto]>`
      WITH deliveries AS (
        SELECT CASE WHEN status = 'FAILED' AND payload->>'code' = 'MAIL_DELIVERY_UNKNOWN' THEN 'UNKNOWN' ELSE status END AS state,
          "createdAt", "sentAt"
        FROM "Notification" WHERE channel = 'EMAIL'
        UNION ALL
        SELECT recipient.state::text, recipient."createdAt", recipient."finishedAt"
        FROM "MailRecipient" recipient
        WHERE recipient."deliveryKey" IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM "Notification" legacy WHERE legacy.channel = 'EMAIL'
            AND legacy."idempotencyKey" = recipient."deliveryKey"
        )
      )
      SELECT count(*) FILTER (WHERE state = 'SENT' AND "sentAt" >= ${since})::int AS "sent7d",
        count(*) FILTER (WHERE state = 'FAILED' AND "createdAt" >= ${since})::int AS "failed7d",
        count(*) FILTER (WHERE state = 'UNKNOWN' AND "createdAt" >= ${since})::int AS "unknown7d",
        max("sentAt") FILTER (WHERE state = 'SENT') AS "lastSentAt"
      FROM deliveries LIMIT 1
    `;
    return result;
  }

  async findBulkRemovalEvents(
    since: Date,
  ): Promise<readonly BulkRemovalEventDto[]> {
    const [teamEvents, programEvents] = await Promise.all([
      this.boundedReads.readAllInBatches(
        (after: string | undefined, take) =>
          this.prisma.teamHistory.findMany({
            take,
            orderBy: { id: 'asc' },
            where: {
              ...(after === undefined ? {} : { id: { gt: after } }),
              event: {
                in: [TeamHistoryEvent.REJECTED, TeamHistoryEvent.DELETED],
              },
              actorId: { not: null },
              occurredAt: { gte: since },
            },
            select: { id: true, actorId: true, occurredAt: true },
          }),
        (row) => row.id,
      ),
      this.boundedReads.readAllInBatches(
        (after: string | undefined, take) =>
          this.prisma.programHistory.findMany({
            take,
            orderBy: { id: 'asc' },
            where: {
              ...(after === undefined ? {} : { id: { gt: after } }),
              event: ProgramHistoryEvent.DELETED,
              actorId: { not: null },
              occurredAt: { gte: since },
            },
            select: { id: true, actorId: true, occurredAt: true },
          }),
        (row) => row.id,
      ),
    ]);
    return [...teamEvents, ...programEvents].flatMap(
      ({ actorId, occurredAt }) =>
        actorId === null ? [] : [{ actorId, occurredAt }],
    );
  }

  async findAdminChangeEvents(
    since: Date,
  ): Promise<readonly AdminChangeEventDto[]> {
    const events = await this.boundedReads.readAllInBatches(
      (after: string | undefined, take) =>
        this.prisma.adminHistory.findMany({
          take,
          orderBy: { id: 'asc' },
          where: {
            ...(after === undefined ? {} : { id: { gt: after } }),
            event: {
              in: [AdminHistoryEvent.GRANTED, AdminHistoryEvent.REVOKED],
            },
            occurredAt: { gte: since },
          },
          select: {
            id: true,
            userId: true,
            actorId: true,
            occurredAt: true,
            user: { select: { nickname: true } },
          },
        }),
      (row) => row.id,
    );
    return events.map(({ user, userId, actorId, occurredAt }) => ({
      userId,
      actorId,
      occurredAt,
      login: user.nickname,
    }));
  }

  async hasActiveCollectionRun(now: Date): Promise<boolean> {
    const active = await this.prisma.collectionSyncLease.count({
      where: { expiresAt: { gt: now } },
    });
    return active > 0;
  }

  async getCollectionRepositorySummary(
    staleBefore: Date,
  ): Promise<CollectionRepositorySummaryDto> {
    const where = this.orgRepositoryWhere();
    const [tracked, stale] = await Promise.all([
      this.prisma.repo.aggregate({
        where,
        _count: { _all: true },
        _max: { lastSuccessAt: true },
      }),
      this.prisma.repo.count({
        where: { ...where, lastSuccessAt: { lt: staleBefore } },
      }),
    ]);
    return {
      trackedRepositoryCount: tracked._count._all,
      staleRepositoryCount: stale,
      lastSuccessAt: tracked._max.lastSuccessAt,
    };
  }

  async listStaleCollectionRepositories(
    staleBefore: Date,
    page: { readonly page: number; readonly limit: number },
  ): Promise<readonly CollectionRepositoryStatusDto[]> {
    const repositories = await this.prisma.repo.findMany({
      take: page.limit,
      skip: (page.page - 1) * page.limit,
      where: {
        ...this.orgRepositoryWhere(),
        lastSuccessAt: { lt: staleBefore },
      },
      orderBy: [{ lastSuccessAt: 'asc' }, { githubRepoId: 'asc' }],
      select: {
        ownerName: true,
        lastSuccessAt: true,
        teamRepos: {
          where: { validTo: null },
          take: 1,
          select: {
            team: {
              select: { name: true, program: { select: { name: true } } },
            },
          },
        },
      },
    });
    return repositories.map((repository) => ({
      repositoryName: repository.ownerName,
      teamName: repository.teamRepos[0]?.team.name ?? null,
      programName: repository.teamRepos[0]?.team.program.name ?? null,
      lastSuccessAt: repository.lastSuccessAt,
    }));
  }

  private orgRepositoryWhere() {
    return {
      presence: 'PRESENT',
      source: 'ORG_PROVISIONED',
      ...this.platform.collectionTargetRepoWhere(),
    } satisfies Prisma.RepoWhereInput;
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
