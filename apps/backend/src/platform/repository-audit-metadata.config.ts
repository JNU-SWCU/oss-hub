import { RepositoryConnectionMode } from '@prisma/client';

export type RepositoryDeletionCounts = {
  readonly repositories: number;
  readonly commits: number;
  readonly contributions: number;
  readonly streams: number;
  readonly pullRequests: number;
  readonly releases: number;
  readonly issues: number;
  readonly outsiders: number;
  readonly invitations: number;
  readonly repositoryYearAggregates: number;
  readonly contributorYearAggregates: number;
};

export const APPLICATION_REPOSITORY_URL_CHANGED =
  'APPLICATION_REPOSITORY_URL_CHANGED';

export type ApplicationRepositoryUrlAuditMetadata = {
  readonly deletedCounts?: RepositoryDeletionCounts;
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

export const REPOSITORY_CONNECTION_AUDIT_SCHEMA_VERSION = 1 as const;

export const REPOSITORY_CONNECTION_AUDIT_ACTIONS = {
  REPOSITORY_CONNECTION_CHANGED: 'REPOSITORY_CONNECTION_CHANGED',
} as const;

export type RepositoryConnectionAuditState = {
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
