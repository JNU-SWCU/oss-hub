export type PurgeDeletionStep = {
  readonly id: string;
  readonly operation: 'DELETE' | 'DETACH' | 'TOMBSTONE' | 'PRESERVE';

  readonly covers: readonly string[];
};

const PURGE_RELATIONS = [
  {
    id: 'program-outbox-events',
    operation: 'DELETE',
    covers: ['logical:Team->OutboxEvent'],
  },
  {
    id: 'program-notifications',
    operation: 'DELETE',
    covers: [
      'logical:Program->Notification[APPLICATION_DECISION,payload.programId]',
      'logical:Program->Notification[APPLICATION_DECISION_ACKNOWLEDGED,idempotencyKey]',
      'logical:Program->Notification[DEADLINE_DIGEST,idempotencyKey]',
      'logical:Program->Notification[TEAM_DELETED,payload.programId]',
    ],
  },
  {
    id: 'board-comments',
    operation: 'DELETE',
    covers: ['BoardPost->BoardComment'],
  },
  {
    id: 'board-posts',
    operation: 'DELETE',
    covers: ['Program->BoardPost'],
  },
  {
    id: 'github-repositories',
    operation: 'DELETE',
    covers: ['Team->GithubRepository'],
  },
  {
    id: 'repository-provision-jobs',
    operation: 'DELETE',

    covers: [
      'Team->RepositoryProvisionJob',
      'GithubRepository->RepositoryProvisionJob',
    ],
  },
  {
    id: 'github-repository-collection-descendants-preserved',
    operation: 'DELETE',

    covers: [
      'GithubRepository->RepositoryInvitation',
      'GithubRepository->Contribution',
      'GithubRepository->CollectionRepositoryStream',
      'GithubRepository->CollectionCommitFact',
      'GithubRepository->CollectionPullRequestFact',
      'GithubRepository->CollectionReleaseFact',
      'GithubRepository->CollectionRepositoryYearAggregate',
      'GithubRepository->CollectionContributorYearAggregate',
      'GithubRepository->GithubIssueHistory',
      'GithubRepository->GithubRepositoryOutsiderContribution',
    ],
  },
  {
    id: 'files',
    operation: 'TOMBSTONE',
    covers: [
      'Program->File',
      'Requirement->File',
      'Team->File',
      'Submission->File',
      'SubmissionHistory->File',
    ],
  },
  {
    id: 'milestone-document-submission-histories',
    operation: 'DELETE',
    covers: ['Submission->SubmissionHistory'],
  },
  {
    id: 'milestone-document-submissions',
    operation: 'DELETE',
    covers: ['Requirement->Submission', 'Team->Submission'],
  },
  {
    id: 'milestone-documents',
    operation: 'DELETE',
    covers: ['Milestone->Requirement'],
  },
  {
    id: 'team-invitations',
    operation: 'DELETE',
    covers: ['Team->TeamInvitation'],
  },
  {
    id: 'team-members',
    operation: 'DELETE',
    covers: ['Team->TeamMember'],
  },
  {
    id: 'team-repos',
    operation: 'DELETE',
    covers: ['Team->TeamRepo'],
  },
  {
    id: 'teams',
    operation: 'DELETE',
    covers: ['Program->Team'],
  },
  {
    id: 'milestones',
    operation: 'DELETE',
    covers: ['Program->Milestone'],
  },
] as const satisfies readonly PurgeDeletionStep[];

export const PROGRAM_PURGE_DELETION_ORDER: readonly PurgeDeletionStep[] =
  PURGE_RELATIONS.map((step) => ({
    ...step,
    operation: step.operation === 'TOMBSTONE' ? 'TOMBSTONE' : 'PRESERVE',
  }));

const TEAM_SUBTREE_PARENTS: ReadonlySet<string> = new Set([
  'Team',
  'GithubRepository',
  'Submission',
  'SubmissionHistory',
]);

const TEAM_ROW_RELATION = 'Program->Team';

const TEAM_SCOPED_LOGICAL_COVERS: Readonly<Record<string, string>> = {
  'logical:Team->OutboxEvent': 'logical:Team->OutboxEvent',
  'logical:Program->Notification[APPLICATION_DECISION,payload.programId]':
    'logical:Team->Notification[APPLICATION_DECISION,payload.teamId]',
  'logical:Program->Notification[APPLICATION_DECISION_ACKNOWLEDGED,idempotencyKey]':
    'logical:Team->Notification[APPLICATION_DECISION_ACKNOWLEDGED,idempotencyKey]',
};

function narrowCoverToTeam(relation: string): string | null {
  if (relation.startsWith('logical:')) {
    return TEAM_SCOPED_LOGICAL_COVERS[relation] ?? null;
  }
  if (relation === TEAM_ROW_RELATION) return relation;
  return TEAM_SUBTREE_PARENTS.has(relation.slice(0, relation.indexOf('->')))
    ? relation
    : null;
}

export const TEAM_PURGE_DELETION_ORDER: readonly PurgeDeletionStep[] =
  PURGE_RELATIONS.map((step) => ({
    id: step.id,
    operation: step.operation,
    covers: step.covers
      .map(narrowCoverToTeam)
      .filter((relation): relation is string => relation !== null),
  })).filter((step) => step.covers.length > 0);
