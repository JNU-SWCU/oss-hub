export type TeamDeletionScopeCounts = {
  readonly applications: number;
  readonly members: number;
  readonly invitations: number;
  readonly submissions: number;

  readonly submissionEvents: number;

  readonly detachedRepositories: number;

  readonly scopeFingerprint: string;
};
