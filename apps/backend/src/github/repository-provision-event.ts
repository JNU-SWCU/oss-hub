import {
  ApplicationStatus,
  RepositoryConnectionMode,
  type Prisma,
} from '@prisma/client';

export type RepositoryProvisionConnectionMode = 'NEW' | 'OWN';

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

export class InvalidRepositoryProvisionEventError extends Error {
  override readonly name = 'InvalidRepositoryProvisionEventError';
}

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

export function repositoryAccessSyncTargetWhere(
  teamId: string,
): Prisma.ApplicationWhereInput {
  return {
    teamId,
    status: ApplicationStatus.APPROVED,
    repositoryConnectionMode: RepositoryConnectionMode.NEW,
    program: { repositoryProvisioningEnabled: true },
  };
}

export function repositoryAccessSyncEventData(
  applicationId: string,
  teamId: string,
  now: Date,
): Prisma.OutboxEventCreateManyInput {
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
