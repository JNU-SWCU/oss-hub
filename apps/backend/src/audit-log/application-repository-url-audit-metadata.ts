import { isJsonObject } from './audit-metadata-validation';

export const APPLICATION_REPOSITORY_URL_CHANGED =
  'APPLICATION_REPOSITORY_URL_CHANGED';
export type ApplicationRepositoryUrlAuditMetadata = {
  readonly schemaVersion: 1;
  readonly programId: string;
  readonly teamId: string;
  readonly programName: string;
  readonly actorGithubLogin: string;
  readonly reason: string;
  readonly before: {
    readonly repositoryId: string | null;
    readonly repositoryUrl: string | null;
  };
  readonly after: {
    readonly repositoryId: string;
    readonly repositoryUrl: string;
  };
};

export function parseApplicationRepositoryUrlAuditMetadata(
  value: unknown,
): ApplicationRepositoryUrlAuditMetadata | null {
  if (
    !isJsonObject(value) ||
    value.schemaVersion !== 1 ||
    typeof value.programId !== 'string' ||
    typeof value.teamId !== 'string' ||
    typeof value.programName !== 'string' ||
    typeof value.actorGithubLogin !== 'string' ||
    typeof value.reason !== 'string' ||
    value.reason.trim().length === 0 ||
    Array.from(value.reason).length > 500 ||
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
    schemaVersion: 1,
    programId: value.programId,
    teamId: value.teamId,
    programName: value.programName,
    actorGithubLogin: value.actorGithubLogin,
    reason: value.reason,
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
