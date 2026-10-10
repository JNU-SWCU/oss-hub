export type ProgramDeletionScopeCounts = {
  readonly applications: number;
  readonly teams: number;
  readonly boardPosts: number;
  readonly submissions: number;

  readonly submissionEvents: number;

  readonly scopeFingerprint: string;
};

export function sameProgramDeletionScopeCounts(
  left: ProgramDeletionScopeCounts,
  right: ProgramDeletionScopeCounts,
): boolean {
  return (
    left.applications === right.applications &&
    left.teams === right.teams &&
    left.boardPosts === right.boardPosts &&
    left.submissions === right.submissions &&
    left.submissionEvents === right.submissionEvents &&
    left.scopeFingerprint === right.scopeFingerprint
  );
}

export function sameProgramDeletionScopeCountValues(
  left: ProgramDeletionScopeCounts,
  right: Omit<ProgramDeletionScopeCounts, 'scopeFingerprint'>,
): boolean {
  return (
    left.applications === right.applications &&
    left.teams === right.teams &&
    left.boardPosts === right.boardPosts &&
    left.submissions === right.submissions &&
    left.submissionEvents === right.submissionEvents
  );
}
