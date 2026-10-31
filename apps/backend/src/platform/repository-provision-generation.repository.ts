import {
  Prisma,
  RepositoryIssuanceOutcome,
  RepositoryProvisionJobStatus,
  type RepositorySource,
  RepositoryVisibility,
  RepositoryConnectionMode,
} from '@prisma/client';
import {
  InvalidRepositoryProvisionHistoryEventError,
  InvalidRepositoryProvisionEventError,
} from './repository-provision-generation.error';

interface RepositoryProvisionHistoryPayload {
  readonly applicationId: string;
  readonly repositoryConnectionMode: RepositoryConnectionMode;
  readonly requestedAt: string;
}

export type RepositoryProvisionHistoryPayloadParser = (
  value: unknown,
) => RepositoryProvisionHistoryPayload;

interface LockedProvisionGenerationRow {
  readonly id: string;
  readonly currentEventId: string | null;
}

interface SynchronousProvisionGenerationRow extends LockedProvisionGenerationRow {
  readonly repositoryId: string | null;
  readonly status: RepositoryProvisionJobStatus;
}

interface RepositoryIssuanceHistoryInput {
  readonly requestId: string;
  readonly applicationId: string;
  readonly repositoryId: string | null;
  readonly source: RepositorySource | null;
  readonly outcome: RepositoryIssuanceOutcome;
  readonly lastErrorCode?: string | null;
  readonly closedAt: Date;
}

export class RepositoryProvisionGenerationRepository {
  static async writeRepositoryIssuanceHistory(
    transaction: Prisma.TransactionClient,
    input: RepositoryIssuanceHistoryInput,
    parsePayload: RepositoryProvisionHistoryPayloadParser,
  ): Promise<void> {
    const event = await transaction.outboxEvent.findUnique({
      where: { id: input.requestId },
      select: {
        aggregateType: true,
        aggregateId: true,
        payload: true,
      },
    });
    if (event === null) {
      throw new InvalidRepositoryProvisionHistoryEventError();
    }

    const payload = parsePayload(event.payload);
    if (
      event.aggregateType !== 'Application' ||
      event.aggregateId !== input.applicationId ||
      payload.applicationId !== input.applicationId
    ) {
      throw new InvalidRepositoryProvisionHistoryEventError();
    }

    await transaction.repositoryIssuanceHistory.createMany({
      data: [
        {
          requestId: input.requestId,
          applicationId: input.applicationId,
          repositoryId: input.repositoryId,
          connectionMode: payload.repositoryConnectionMode,
          source: input.source,
          outcome: input.outcome,
          lastErrorCode: input.lastErrorCode ?? null,
          requestedAt: new Date(payload.requestedAt),
          closedAt: input.closedAt,
        },
      ],
      skipDuplicates: true,
    });
  }

  static async transferProvisionGeneration(
    transaction: Prisma.TransactionClient,
    input: {
      readonly applicationId: string;
      readonly newEventId: string;
      readonly now: Date;
    },
    parsePayload: RepositoryProvisionHistoryPayloadParser,
  ): Promise<{ readonly jobId: string }> {
    const rows = await transaction.$queryRaw<LockedProvisionGenerationRow[]>(
      Prisma.sql`
      SELECT
        job."id",
        job."currentEventId"
      FROM "RepositoryProvisionJob" AS job
      WHERE job."applicationId" = ${input.applicationId}
      FOR UPDATE OF job
    `,
    );
    const existing = rows[0];

    if (
      existing?.currentEventId != null &&
      existing.currentEventId !== input.newEventId
    ) {
      await RepositoryProvisionGenerationRepository.writeRepositoryIssuanceHistory(
        transaction,
        {
          requestId: existing.currentEventId,
          applicationId: input.applicationId,
          repositoryId: null,
          source: null,
          outcome: RepositoryIssuanceOutcome.SUPERSEDED,
          closedAt: input.now,
        },
        parsePayload,
      );
    }

    if (existing === undefined) {
      const created = await transaction.repositoryProvisionJob.create({
        data: {
          applicationId: input.applicationId,
          currentEventId: input.newEventId,
          status: RepositoryProvisionJobStatus.PENDING,
          nextAttemptAt: input.now,
        },
        select: { id: true },
      });
      return { jobId: created.id };
    }

    await transaction.repositoryProvisionJob.update({
      where: { id: existing.id },
      data: {
        currentEventId: input.newEventId,
        repositoryId: null,
        status: RepositoryProvisionJobStatus.PENDING,
        nextAttemptAt: input.now,
        attemptCount: 0,
        lockedAt: null,
        lockedBy: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        startedAt: null,
        finishedAt: null,
      },
    });
    return { jobId: existing.id };
  }

  static async settleProvisionGenerationForSynchronousConnection(
    transaction: Prisma.TransactionClient,
    input: {
      readonly applicationId: string;
      readonly repositoryId: string;
      readonly now: Date;
    },
    parseEvent: RepositoryProvisionHistoryPayloadParser,
  ): Promise<void> {
    const existing = (
      await transaction.$queryRaw<readonly SynchronousProvisionGenerationRow[]>(
        Prisma.sql`
        SELECT
          job."id",
          job."currentEventId",
          job."repositoryId",
          job."status"
        FROM "RepositoryProvisionJob" AS job
        WHERE job."applicationId" = ${input.applicationId}
        FOR UPDATE
      `,
      )
    )[0];

    if (existing?.currentEventId != null) {
      await RepositoryProvisionGenerationRepository.writeRepositoryIssuanceHistory(
        transaction,
        {
          requestId: existing.currentEventId,
          applicationId: input.applicationId,
          repositoryId: null,
          source: null,
          outcome: RepositoryIssuanceOutcome.SUPERSEDED,
          closedAt: input.now,
        },
        parseEvent,
      );
    }
    if (
      existing?.currentEventId === null &&
      existing.repositoryId === input.repositoryId &&
      existing.status === RepositoryProvisionJobStatus.SUCCEEDED
    ) {
      return;
    }

    await transaction.repositoryProvisionJob.upsert({
      where: { applicationId: input.applicationId },
      create: {
        applicationId: input.applicationId,
        currentEventId: null,
        repositoryId: input.repositoryId,
        status: RepositoryProvisionJobStatus.SUCCEEDED,
        nextAttemptAt: input.now,
        finishedAt: input.now,
      },
      update: {
        currentEventId: null,
        repositoryId: input.repositoryId,
        status: RepositoryProvisionJobStatus.SUCCEEDED,
        nextAttemptAt: input.now,
        attemptCount: 0,
        lockedAt: null,
        lockedBy: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        startedAt: null,
        finishedAt: input.now,
      },
    });
  }
}

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

export type UnknownRecord = { readonly [key: string]: unknown };

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requiredString(record: UnknownRecord, key: string): string {
  const value = record[key];
  if (!isNonEmptyString(value)) {
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

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const APPLICATION_REPOSITORY_URL_CHANGED =
  'APPLICATION_REPOSITORY_URL_CHANGED';

export type ApplicationRepositoryUrlAuditMetadata = {
  readonly schemaVersion: 2;
  readonly programId: string;
  readonly teamId: string;
  readonly programName: string;
  readonly actorGithubLogin: string;
  readonly before: {
    readonly repositoryId: string | null;
    readonly repositoryUrl: string | null;
  };
  readonly after: {
    readonly repositoryId: string;
    readonly repositoryUrl: string;
  };
};

export type ApplicationRepositoryUrlAuditMetadataView =
  | ApplicationRepositoryUrlAuditMetadata
  | (Omit<ApplicationRepositoryUrlAuditMetadata, 'schemaVersion'> & {
      readonly schemaVersion: 1;
      readonly reason: string;
    });

export function parseApplicationRepositoryUrlAuditMetadata(
  value: unknown,
): ApplicationRepositoryUrlAuditMetadataView | null {
  if (
    !isJsonObject(value) ||
    (value.schemaVersion !== 1 && value.schemaVersion !== 2) ||
    typeof value.programId !== 'string' ||
    typeof value.teamId !== 'string' ||
    typeof value.programName !== 'string' ||
    typeof value.actorGithubLogin !== 'string' ||
    (value.schemaVersion === 1 &&
      (typeof value.reason !== 'string' ||
        value.reason.trim().length === 0 ||
        Array.from(value.reason).length > 500)) ||
    (value.schemaVersion === 2 && 'reason' in value) ||
    !isJsonObject(value.before) ||
    !isJsonObject(value.after) ||
    !(
      value.before.repositoryId === null ||
      typeof value.before.repositoryId === 'string'
    ) ||
    !(
      value.before.repositoryUrl === null ||
      typeof value.before.repositoryUrl === 'string'
    ) ||
    typeof value.after.repositoryId !== 'string' ||
    typeof value.after.repositoryUrl !== 'string'
  )
    return null;
  return {
    ...(value.schemaVersion === 1
      ? { schemaVersion: 1 as const, reason: value.reason as string }
      : { schemaVersion: 2 as const }),
    programId: value.programId,
    teamId: value.teamId,
    programName: value.programName,
    actorGithubLogin: value.actorGithubLogin,
    before: {
      repositoryId: value.before.repositoryId,
      repositoryUrl: value.before.repositoryUrl,
    },
    after: {
      repositoryId: value.after.repositoryId,
      repositoryUrl: value.after.repositoryUrl,
    },
  };
}

const REPOSITORY_CONNECTION_AUDIT_SCHEMA_VERSION = 1 as const;

export const REPOSITORY_CONNECTION_AUDIT_ACTIONS = {
  REPOSITORY_CONNECTION_CHANGED: 'REPOSITORY_CONNECTION_CHANGED',
} as const;

type RepositoryConnectionAuditState = {
  readonly repositoryId: string | null;
  readonly nameWithOwner: string | null;
  readonly connectionMode: RepositoryConnectionMode;
  readonly repositoryUrl: string | null;
};

export type RepositoryConnectionAuditMetadata = {
  readonly schemaVersion: typeof REPOSITORY_CONNECTION_AUDIT_SCHEMA_VERSION;
  readonly applicationId: string;
  readonly before: RepositoryConnectionAuditState;
  readonly after: RepositoryConnectionAuditState;
};

export type RepositoryConnectionAuditMetadataView =
  RepositoryConnectionAuditMetadata;

export function createRepositoryConnectionAuditMetadata(
  input: Omit<RepositoryConnectionAuditMetadata, 'schemaVersion'>,
): RepositoryConnectionAuditMetadata {
  return {
    schemaVersion: REPOSITORY_CONNECTION_AUDIT_SCHEMA_VERSION,
    ...input,
  };
}

export function parseRepositoryConnectionAuditMetadata(
  value: unknown,
): RepositoryConnectionAuditMetadataView | null {
  if (
    !isJsonObject(value) ||
    value.schemaVersion !== REPOSITORY_CONNECTION_AUDIT_SCHEMA_VERSION ||
    typeof value.applicationId !== 'string' ||
    !isRepositoryConnectionState(value.before) ||
    !isRepositoryConnectionState(value.after)
  ) {
    return null;
  }
  return {
    schemaVersion: REPOSITORY_CONNECTION_AUDIT_SCHEMA_VERSION,
    applicationId: value.applicationId,
    before: {
      repositoryId: value.before.repositoryId,
      nameWithOwner: value.before.nameWithOwner,
      connectionMode: value.before.connectionMode,
      repositoryUrl: value.before.repositoryUrl,
    },
    after: {
      repositoryId: value.after.repositoryId,
      nameWithOwner: value.after.nameWithOwner,
      connectionMode: value.after.connectionMode,
      repositoryUrl: value.after.repositoryUrl,
    },
  };
}

function isRepositoryConnectionState(
  value: unknown,
): value is RepositoryConnectionAuditState {
  return (
    isJsonObject(value) &&
    (value.repositoryId === null || typeof value.repositoryId === 'string') &&
    (value.nameWithOwner === null || typeof value.nameWithOwner === 'string') &&
    (value.connectionMode === RepositoryConnectionMode.NEW ||
      value.connectionMode === RepositoryConnectionMode.OWN) &&
    (value.repositoryUrl === null || typeof value.repositoryUrl === 'string')
  );
}
