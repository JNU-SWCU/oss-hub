import { RepositoryConnectionMode } from '@prisma/client';

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
