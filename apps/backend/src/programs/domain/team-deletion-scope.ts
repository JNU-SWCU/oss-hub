export type TeamDeletionScopeCounts = {
  readonly applications: number;
  readonly members: number;
  readonly invitations: number;
  readonly submissions: number;

  readonly submissionEvents: number;

  readonly detachedRepositories: number;

  readonly scopeFingerprint: string;
};

export function sameTeamDeletionScopeCounts(
  left: TeamDeletionScopeCounts,
  right: TeamDeletionScopeCounts,
): boolean {
  return (
    sameTeamDeletionScopeCountValues(left, right) &&
    left.scopeFingerprint === right.scopeFingerprint
  );
}

export function sameTeamDeletionScopeCountValues(
  left: TeamDeletionScopeCounts,
  right: Omit<TeamDeletionScopeCounts, 'scopeFingerprint'>,
): boolean {
  return (
    left.applications === right.applications &&
    left.members === right.members &&
    left.invitations === right.invitations &&
    left.submissions === right.submissions &&
    left.submissionEvents === right.submissionEvents &&
    left.detachedRepositories === right.detachedRepositories
  );
}
