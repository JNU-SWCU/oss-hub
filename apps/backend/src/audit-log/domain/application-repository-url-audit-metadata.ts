import { isJsonObject } from './audit-metadata-validation';

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
