import { Injectable } from '@nestjs/common';
import {
  ApplicationStatus,
  OutboxEventStatus,
  Prisma,
  RepositoryConnectionMode,
  RepositoryInvitationStatus,
  RepositoryIssuanceOutcome,
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
  RepositorySource,
} from '@prisma/client';
import type { AuditLogTransactionWriter } from '../platform/audit-log-transaction-writer.types';
import { RepositoryProvisionGenerationRepository } from '../platform/repository-provision-generation.repository';
import { PrismaService } from '../platform/prisma.service';
import { InvalidRepositoryProvisionEventError } from './repositories.error';

export const PUBLISH_BLOCKED_REASONS = {
  REPOSITORY_NOT_READY: 'REPOSITORY_NOT_READY',
  REPOSITORY_PUBLICATION_NOT_PLANNED: 'REPOSITORY_PUBLICATION_NOT_PLANNED',
  PROGRAM_NOT_ENDED: 'PROGRAM_NOT_ENDED',
  REQUIRED_MILESTONES_NOT_APPROVED: 'REQUIRED_MILESTONES_NOT_APPROVED',
} as const;

export type PublishBlockedReason =
  (typeof PUBLISH_BLOCKED_REASONS)[keyof typeof PUBLISH_BLOCKED_REASONS];

export interface RepositoryPublishEligibility {
  readonly repositoryId: string;
  readonly visibility: RepositoryVisibility;
  readonly provisionStatus: RepositoryProvisionJobStatus | null;
  readonly requiredMilestonesApproved: boolean;
  readonly isRepositoryPublicationPlanned: boolean;
  readonly programEndAt: Date;
}

export function publishBlockedReasons(
  eligibility: Omit<RepositoryPublishEligibility, 'repositoryId'>,
  now: Date,
): readonly PublishBlockedReason[] {
  if (eligibility.visibility !== RepositoryVisibility.PRIVATE) return [];
  return [
    ...(eligibility.provisionStatus === RepositoryProvisionJobStatus.SUCCEEDED
      ? []
      : [PUBLISH_BLOCKED_REASONS.REPOSITORY_NOT_READY]),
    ...(eligibility.isRepositoryPublicationPlanned
      ? []
      : [PUBLISH_BLOCKED_REASONS.REPOSITORY_PUBLICATION_NOT_PLANNED]),
    ...(eligibility.programEndAt.getTime() <= now.getTime()
      ? []
      : [PUBLISH_BLOCKED_REASONS.PROGRAM_NOT_ENDED]),
    ...(eligibility.requiredMilestonesApproved
      ? []
      : [PUBLISH_BLOCKED_REASONS.REQUIRED_MILESTONES_NOT_APPROVED]),
  ];
}

export function repositoryNameFromNameWithOwner(nameWithOwner: string): string {
  const slashIndex = nameWithOwner.lastIndexOf('/');
  return slashIndex === -1
    ? nameWithOwner
    : nameWithOwner.slice(slashIndex + 1);
}

export function repositoryUrlFromNameWithOwner(nameWithOwner: string): string {
  return `https://github.com/${nameWithOwner}`;
}

type RepositoryProvisionConnectionMode = 'NEW' | 'OWN';

export interface RepositoryProvisionEventPayload {
  readonly applicationId: string;
  readonly programId: string;
  readonly teamId: string | null;
  readonly requestedAt: string;
  readonly collaboratorGithubLogins: readonly string[];

  readonly repositoryConnectionMode: RepositoryProvisionConnectionMode;
  readonly repositoryUrl: string | null;

  readonly requestedByGithubId?: string | null;
}

export interface RepositoryAccessSyncEventPayload {
  readonly applicationId: string;
  readonly teamId: string;
  readonly requestedAt: string;
}

export const REPOSITORY_PROVISION_EVENT_TYPE =
  'REPOSITORY_PROVISION_REQUESTED' as const;

export const REPOSITORY_ACCESS_SYNC_EVENT_TYPE =
  'REPOSITORY_ACCESS_SYNC_REQUESTED' as const;

export function parseRepositoryProvisionEvent(
  value: unknown,
): RepositoryProvisionEventPayload {
  if (!isRecord(value)) {
    throw new InvalidRepositoryProvisionEventError();
  }
  const applicationId = requiredString(value, 'applicationId');
  const programId = requiredString(value, 'programId');
  const requestedAt = requiredString(value, 'requestedAt');
  const requestedTimestamp = Date.parse(requestedAt);
  if (
    Number.isNaN(requestedTimestamp) ||
    new Date(requestedTimestamp).toISOString() !== requestedAt
  ) {
    throw new InvalidRepositoryProvisionEventError();
  }
  const teamId = value.teamId;
  if (teamId !== null && !isNonEmptyString(teamId)) {
    throw new InvalidRepositoryProvisionEventError();
  }
  const collaboratorGithubLogins = value.collaboratorGithubLogins;
  if (
    !Array.isArray(collaboratorGithubLogins) ||
    collaboratorGithubLogins.length === 0 ||
    !collaboratorGithubLogins.every(isGithubLogin)
  ) {
    throw new InvalidRepositoryProvisionEventError();
  }
  const canonicalLogins = [...new Set(collaboratorGithubLogins)].sort();
  if (
    canonicalLogins.length !== collaboratorGithubLogins.length ||
    canonicalLogins.some(
      (login, index) => login !== collaboratorGithubLogins[index],
    )
  ) {
    throw new InvalidRepositoryProvisionEventError();
  }

  const hasConnectionMode = Object.prototype.hasOwnProperty.call(
    value,
    'repositoryConnectionMode',
  );
  const hasRepositoryUrl = Object.prototype.hasOwnProperty.call(
    value,
    'repositoryUrl',
  );

  if (hasConnectionMode !== hasRepositoryUrl) {
    throw new InvalidRepositoryProvisionEventError();
  }

  let repositoryConnectionMode: RepositoryProvisionConnectionMode = 'NEW';
  let repositoryUrl: string | null = null;
  if (hasConnectionMode) {
    const mode = value.repositoryConnectionMode;
    if (mode !== 'NEW' && mode !== 'OWN') {
      throw new InvalidRepositoryProvisionEventError();
    }
    repositoryConnectionMode = mode;
    const url = value.repositoryUrl;
    if (repositoryConnectionMode === 'NEW') {
      if (url !== null) {
        throw new InvalidRepositoryProvisionEventError();
      }
      repositoryUrl = null;
    } else {
      if (!isNonEmptyString(url) || !URL.canParse(url)) {
        throw new InvalidRepositoryProvisionEventError();
      }
      repositoryUrl = url;
    }
  }
  const requestedByGithubId = value.requestedByGithubId;
  if (
    requestedByGithubId !== undefined &&
    requestedByGithubId !== null &&
    (typeof requestedByGithubId !== 'string' ||
      !/^[1-9][0-9]*$/.test(requestedByGithubId))
  ) {
    throw new InvalidRepositoryProvisionEventError();
  }

  return {
    applicationId,
    programId,
    teamId,
    requestedAt,
    collaboratorGithubLogins,
    repositoryConnectionMode,
    repositoryUrl,
    ...(requestedByGithubId === undefined ? {} : { requestedByGithubId }),
  };
}

const ACCESS_SYNC_PAYLOAD_KEYS = [
  'applicationId',
  'teamId',
  'requestedAt',
] as const;

export function parseRepositoryAccessSyncEvent(
  value: unknown,
): RepositoryAccessSyncEventPayload {
  if (!isRecord(value)) {
    throw new InvalidRepositoryProvisionEventError();
  }
  const keys = Object.keys(value);
  if (
    keys.length !== ACCESS_SYNC_PAYLOAD_KEYS.length ||
    !ACCESS_SYNC_PAYLOAD_KEYS.every((key) => keys.includes(key))
  ) {
    throw new InvalidRepositoryProvisionEventError();
  }
  return {
    applicationId: requiredString(value, 'applicationId'),
    teamId: requiredString(value, 'teamId'),
    requestedAt: requiredIsoTimestamp(value, 'requestedAt'),
  };
}

export function repositoryAccessSyncEventData(
  applicationId: string,
  teamId: string,
  now: Date,
) {
  const requestedAt = now.toISOString();
  return {
    type: REPOSITORY_ACCESS_SYNC_EVENT_TYPE,
    aggregateType: 'Application',
    aggregateId: applicationId,
    idempotencyKey: `repository-access-sync:${applicationId}:${requestedAt}`,
    payload: { applicationId, teamId, requestedAt },
    availableAt: now,
  };
}

type UnknownRecord = { readonly [key: string]: unknown };

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(record: UnknownRecord, key: string): string {
  const value = record[key];
  if (!isNonEmptyString(value)) {
    throw new InvalidRepositoryProvisionEventError();
  }
  return value;
}

function requiredIsoTimestamp(record: UnknownRecord, key: string): string {
  const value = requiredString(record, key);
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new InvalidRepositoryProvisionEventError();
  }
  return value;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value !== '';
}

function isGithubLogin(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(value)
  );
}

export function canonicalGithubLogin(login: string | null | undefined): string {
  return (login ?? '').trim().toLowerCase();
}

export function canonicalGithubLogins(
  logins: readonly (string | null | undefined)[],
): readonly string[] {
  return [
    ...new Set(
      logins.map(canonicalGithubLogin).filter((login) => login.length > 0),
    ),
  ].sort();
}

export interface ClaimProvisionEventInput {
  readonly workerId: string;
  readonly now: Date;
  readonly leaseMs: number;
}

export interface ClaimedProvisionEvent {
  readonly id: string;
  readonly aggregateId: string;

  readonly type: string;
  readonly payload: Prisma.JsonValue;
}

export interface ProvisionJobReference {
  readonly id: string;
  readonly currentEventId: string | null;
}
export interface OwnedProvisionJob {
  readonly application: {
    readonly id: string;
    readonly teamId: string | null;
    readonly repositoryConnectionMode: RepositoryConnectionMode;
    readonly applicant: {
      readonly nickname: string;
    };
    readonly program: {
      readonly name: string;
    };
    readonly team: {
      readonly name: string;
      readonly _count: { readonly members: number };
    } | null;

    readonly repository: {
      readonly id: string;
      readonly name: string;
      readonly url: string;
      readonly visibility: RepositoryVisibility;
      readonly source: RepositorySource;
      readonly invitations: readonly {
        readonly status: RepositoryInvitationStatus;
      }[];
    } | null;
  };
  readonly status: RepositoryProvisionJobStatus;
  readonly lastErrorCode: string | null;
  readonly updatedAt: Date;
}

export interface RepositoryPublishTarget {
  readonly id: string;
  readonly githubRepositoryId: bigint;
  readonly name: string;
  readonly url: string;
  readonly visibility: RepositoryVisibility;
  readonly publishedAt: Date | null;
}

function toPublishTarget(row: {
  readonly id: string;
  readonly githubRepositoryId: bigint;
  readonly nameWithOwner: string;
  readonly visibility: RepositoryVisibility;
  readonly publishedAt: Date | null;
}): RepositoryPublishTarget {
  return {
    id: row.id,
    githubRepositoryId: row.githubRepositoryId,
    name: repositoryNameFromNameWithOwner(row.nameWithOwner),
    url: repositoryUrlFromNameWithOwner(row.nameWithOwner),
    visibility: row.visibility,
    publishedAt: row.publishedAt,
  };
}

function toOwnedRepository(row: {
  readonly id: string;
  readonly nameWithOwner: string;
  readonly source: RepositorySource;
  readonly visibility: RepositoryVisibility;
  readonly invitations: readonly {
    readonly status: RepositoryInvitationStatus;
  }[];
}): NonNullable<OwnedProvisionJob['application']['repository']> {
  return {
    id: row.id,
    name: repositoryNameFromNameWithOwner(row.nameWithOwner),
    url: repositoryUrlFromNameWithOwner(row.nameWithOwner),
    visibility: row.visibility,
    source: row.source,
    invitations: row.invitations,
  };
}

export interface RepositoriesTransactionStore {
  readonly auditLogWriter: AuditLogTransactionWriter;
  claimProvisionEvent(
    input: ClaimProvisionEventInput,
  ): Promise<ClaimedProvisionEvent | null>;
  upsertProvisionJob(
    applicationId: string,
    now: Date,
  ): Promise<ProvisionJobReference>;
  findProvisionJob(
    applicationId: string,
  ): Promise<ProvisionJobReference | null>;
  confirmSupersededProvisionEvent(
    eventId: string,
    applicationId: string,
    now: Date,
  ): Promise<void>;
  completeProvisionEvent(
    eventId: string,
    workerId: string,
    now: Date,
  ): Promise<void>;
  failProvisionEvent(eventId: string, workerId: string): Promise<void>;
  findPublishTarget(
    repositoryId: string,
  ): Promise<RepositoryPublishTarget | null>;
  publishRepositoryIfPrivate(
    repositoryId: string,
    githubRepositoryId: bigint,
    now: Date,
  ): Promise<boolean>;
}

type ClaimedProvisionEventRow = ClaimedProvisionEvent;

type LockedProvisionJobRow = {
  readonly id: string;
  readonly status: RepositoryProvisionJobStatus;
  readonly nextAttemptAt: Date;
  readonly currentEventId: string | null;
};

class PrismaRepositoriesTransactionRepository implements RepositoriesTransactionStore {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  get auditLogWriter(): AuditLogTransactionWriter {
    return this.transaction;
  }

  async findPublishTarget(
    repositoryId: string,
  ): Promise<RepositoryPublishTarget | null> {
    const repository = await this.transaction.githubRepository.findUnique({
      where: { id: repositoryId },
      select: {
        id: true,
        githubRepositoryId: true,
        nameWithOwner: true,
        visibility: true,
        publishedAt: true,
      },
    });
    return repository === null ? null : toPublishTarget(repository);
  }

  async publishRepositoryIfPrivate(
    repositoryId: string,
    githubRepositoryId: bigint,
    now: Date,
  ): Promise<boolean> {
    const updated = await this.transaction.githubRepository.updateMany({
      where: {
        id: repositoryId,
        githubRepositoryId,
        visibility: RepositoryVisibility.PRIVATE,
      },
      data: {
        visibility: RepositoryVisibility.PUBLIC,
        publishedAt: now,
      },
    });
    return updated.count === 1;
  }

  async claimProvisionEvent(
    input: ClaimProvisionEventInput,
  ): Promise<ClaimedProvisionEvent | null> {
    const leaseCutoff = new Date(input.now.getTime() - input.leaseMs);
    const events = await this.transaction.$queryRaw<
      ClaimedProvisionEventRow[]
    >(Prisma.sql`
      WITH candidate AS (
        SELECT "id"
        FROM "OutboxEvent"
        WHERE "type" IN (
            ${REPOSITORY_PROVISION_EVENT_TYPE},
            ${REPOSITORY_ACCESS_SYNC_EVENT_TYPE}
          )
          AND "aggregateType" = 'Application'
          AND "availableAt" <= ${input.now}
          AND (
            "status" = CAST(${OutboxEventStatus.PENDING} AS "OutboxEventStatus")
            OR (
              "status" = CAST(${OutboxEventStatus.PROCESSING} AS "OutboxEventStatus")
              AND "lockedAt" < ${leaseCutoff}
            )
          )
        ORDER BY "createdAt", "id"
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "OutboxEvent" AS event
      SET "status" = CAST(${OutboxEventStatus.PROCESSING} AS "OutboxEventStatus"),
          "attemptCount" = event."attemptCount" + 1,
          "lockedAt" = ${input.now},
          "lockedBy" = ${input.workerId},
          "updatedAt" = ${input.now}
      FROM candidate
      WHERE event."id" = candidate."id"
      RETURNING event."id", event."aggregateId", event."type", event."payload"
    `);
    return events[0] ?? null;
  }

  async upsertProvisionJob(
    applicationId: string,
    now: Date,
  ): Promise<ProvisionJobReference> {
    const locked = await this.transaction.$queryRaw<LockedProvisionJobRow[]>(
      Prisma.sql`
        SELECT "id", "status", "nextAttemptAt", "currentEventId"
        FROM "RepositoryProvisionJob"
        WHERE "applicationId" = ${applicationId}
        FOR UPDATE
      `,
    );
    const existing = locked[0];
    if (existing === undefined) {
      return this.transaction.repositoryProvisionJob.upsert({
        where: { applicationId },
        update: {},
        create: {
          applicationId,
          status: RepositoryProvisionJobStatus.PENDING,
          nextAttemptAt: now,
        },
        select: { id: true, currentEventId: true },
      });
    }

    if (
      existing.status === RepositoryProvisionJobStatus.SUCCEEDED ||
      existing.status === RepositoryProvisionJobStatus.FAILED_FINAL
    ) {
      await this.transaction.repositoryProvisionJob.update({
        where: { id: existing.id },
        data: {
          status: RepositoryProvisionJobStatus.PENDING,
          nextAttemptAt: now,
          attemptCount: 0,
          lastErrorCode: null,
          lastErrorMessage: null,
          finishedAt: null,
        },
      });
      return {
        id: existing.id,
        currentEventId: existing.currentEventId,
      };
    }

    if (
      existing.status === RepositoryProvisionJobStatus.PENDING ||
      existing.status === RepositoryProvisionJobStatus.FAILED_RETRYABLE
    ) {
      if (existing.nextAttemptAt.getTime() > now.getTime()) {
        await this.transaction.repositoryProvisionJob.update({
          where: { id: existing.id },
          data: { nextAttemptAt: now },
        });
      }
      return {
        id: existing.id,
        currentEventId: existing.currentEventId,
      };
    }

    return {
      id: existing.id,
      currentEventId: existing.currentEventId,
    };
  }

  async findProvisionJob(
    applicationId: string,
  ): Promise<ProvisionJobReference | null> {
    return this.transaction.repositoryProvisionJob.findUnique({
      where: { applicationId },
      select: { id: true, currentEventId: true },
    });
  }

  async confirmSupersededProvisionEvent(
    eventId: string,
    applicationId: string,
    now: Date,
  ): Promise<void> {
    await RepositoryProvisionGenerationRepository.writeRepositoryIssuanceHistory(
      this.transaction,
      {
        requestId: eventId,
        applicationId,
        repositoryId: null,
        source: null,
        outcome: RepositoryIssuanceOutcome.SUPERSEDED,
        closedAt: now,
      },
      parseRepositoryProvisionEvent,
    );
  }

  async completeProvisionEvent(
    eventId: string,
    workerId: string,
    now: Date,
  ): Promise<void> {
    await this.transaction.outboxEvent.updateMany({
      where: {
        id: eventId,
        status: OutboxEventStatus.PROCESSING,
        lockedBy: workerId,
      },
      data: {
        status: OutboxEventStatus.PROCESSED,
        lockedAt: null,
        lockedBy: null,
        processedAt: now,
        lastError: null,
      },
    });
  }

  async failProvisionEvent(eventId: string, workerId: string): Promise<void> {
    await this.transaction.outboxEvent.updateMany({
      where: {
        id: eventId,
        status: OutboxEventStatus.PROCESSING,
        lockedBy: workerId,
      },
      data: {
        status: OutboxEventStatus.FAILED,
        lockedAt: null,
        lockedBy: null,
        lastError: 'INVALID_REPOSITORY_PROVISION_EVENT',
      },
    });
  }
}

@Injectable()
export class RepositoriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async withTransaction<T>(
    operation: (store: RepositoriesTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(new PrismaRepositoriesTransactionRepository(transaction)),
    );
  }
  async listOwnedProvisionJobs(
    githubId: bigint,
  ): Promise<readonly OwnedProvisionJob[]> {
    const user = await this.prisma.user.findUnique({
      where: { githubId },
      select: { nickname: true },
    });
    if (user === null) {
      return [];
    }

    const jobs = await this.prisma.repositoryProvisionJob.findMany({
      where: {
        application: {
          status: ApplicationStatus.APPROVED,

          team: {
            members: { some: { user: { githubId } } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        status: true,
        lastErrorCode: true,
        updatedAt: true,
        application: {
          select: {
            id: true,
            teamId: true,
            repositoryConnectionMode: true,
            applicant: {
              select: { nickname: true },
            },
            program: {
              select: { name: true },
            },
            team: {
              select: { name: true, _count: { select: { members: true } } },
            },
            repository: {
              select: {
                id: true,
                nameWithOwner: true,
                visibility: true,
                source: true,
                invitations: {
                  where: {
                    githubLogin: {
                      equals: user.nickname.trim(),
                      mode: 'insensitive',
                    },
                  },
                  select: { status: true },
                },
              },
            },
          },
        },
      },
    });
    return jobs.map((job) => ({
      ...job,
      application: {
        ...job.application,
        repository:
          job.application.repository === null
            ? null
            : toOwnedRepository(job.application.repository),
      },
    }));
  }

  async findPublishTarget(
    repositoryId: string,
  ): Promise<RepositoryPublishTarget | null> {
    const repository = await this.prisma.githubRepository.findUnique({
      where: { id: repositoryId },
      select: {
        id: true,
        githubRepositoryId: true,
        nameWithOwner: true,
        visibility: true,
        publishedAt: true,
      },
    });
    return repository === null ? null : toPublishTarget(repository);
  }
}
