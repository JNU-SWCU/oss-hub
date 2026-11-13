export type RepositoryDeletionCounts = {
  readonly repositories: number;
  readonly commits: number;
  readonly contributions: number;
  readonly streams: number;
  readonly pullRequests: number;
  readonly releases: number;
  readonly issues: number;
  readonly invitations: number;
};

type ApplicationRepositoryUrlAuditMetadata = {
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
