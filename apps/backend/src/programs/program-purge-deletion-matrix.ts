export type PurgeDeletionStep = {
  readonly id: string;
  readonly operation: 'DELETE' | 'DETACH' | 'TOMBSTONE' | 'PRESERVE';

  readonly covers: readonly string[];
};

export const PROGRAM_PURGE_DELETION_ORDER = [
  {
    id: 'program-outbox-events',
    operation: 'DELETE',
    covers: [
      'logical:Program->OutboxEvent',
      'logical:Application->OutboxEvent',
    ],
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
    operation: 'DETACH',
    covers: [
      'Program->GithubRepository',
      'Application->GithubRepository',
      'Team->GithubRepository',
    ],
  },
  {
    id: 'repository-provision-jobs',
    operation: 'DELETE',

    covers: [
      'Application->RepositoryProvisionJob',
      'GithubRepository->RepositoryProvisionJob',
    ],
  },
  {
    id: 'github-repository-collection-descendants-preserved',
    operation: 'PRESERVE',

    covers: [
      'GithubRepository->RepositoryInvitation',
      'GithubRepository->Contribution',
      'GithubRepository->CollectionRepositoryStream',
      'GithubRepository->CollectionCommitFact',
      'GithubRepository->CollectionPullRequestFact',
      'GithubRepository->CollectionReleaseFact',
      'GithubRepository->GithubIssueHistory',
      'GithubRepository->GithubRepositoryOutsiderContribution',
    ],
  },
  {
    id: 'submission-files',
    operation: 'DETACH',
    covers: [
      'Milestone->SubmissionFile',
      'Application->SubmissionFile',
      'MilestoneDocumentSubmission->SubmissionFile',
      'MilestoneDocumentSubmissionHistory->SubmissionFile',
    ],
  },
  {
    id: 'program-authoring-uploads',
    operation: 'DETACH',
    covers: ['ProgramCreateRequest->ProgramAuthoringUpload'],
  },
  {
    id: 'milestone-document-template-file-tombstones',
    operation: 'TOMBSTONE',
    covers: ['MilestoneDocument->MilestoneDocumentTemplateFile'],
  },
  {
    id: 'milestone-document-review-histories',
    operation: 'DELETE',
    covers: [
      'MilestoneDocumentSubmission->MilestoneDocumentReviewHistory',
      'MilestoneDocumentSubmissionHistory->MilestoneDocumentReviewHistory',
    ],
  },
  {
    id: 'milestone-document-submission-histories',
    operation: 'DELETE',
    covers: ['MilestoneDocumentSubmission->MilestoneDocumentSubmissionHistory'],
  },
  {
    id: 'milestone-document-submissions',
    operation: 'DELETE',
    covers: [
      'MilestoneDocument->MilestoneDocumentSubmission',
      'Application->MilestoneDocumentSubmission',
    ],
  },
  {
    id: 'milestone-document-template-files',
    operation: 'DELETE',
    covers: ['MilestoneDocument->MilestoneDocumentTemplateFile'],
  },
  {
    id: 'milestone-documents',
    operation: 'DELETE',
    covers: ['Milestone->MilestoneDocument'],
  },
  {
    id: 'application-review-histories',
    operation: 'DELETE',

    covers: ['Application->ApplicationReviewHistory'],
  },
  {
    id: 'applications',
    operation: 'DELETE',
    covers: ['Program->Application', 'Team->Application'],
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
    id: 'teams',
    operation: 'DELETE',
    covers: ['Program->Team'],
  },
  {
    id: 'program-create-requests',
    operation: 'DELETE',
    covers: ['Program->ProgramCreateRequest'],
  },
  {
    id: 'milestones',
    operation: 'DELETE',
    covers: ['Program->Milestone'],
  },
  {
    id: 'program-cover-tombstones',
    operation: 'TOMBSTONE',
    covers: ['Program->ProgramCover'],
  },
] as const satisfies readonly PurgeDeletionStep[];

const TEAM_SUBTREE_PARENTS: ReadonlySet<string> = new Set([
  'Team',
  'Application',
  'GithubRepository',
  'MilestoneDocumentSubmission',
  'MilestoneDocumentSubmissionHistory',
]);

const TEAM_ROW_RELATION = 'Program->Team';

const TEAM_SCOPED_LOGICAL_COVERS: Readonly<Record<string, string>> = {
  'logical:Application->OutboxEvent': 'logical:Application->OutboxEvent',
  'logical:Program->Notification[APPLICATION_DECISION,payload.programId]':
    'logical:Application->Notification[APPLICATION_DECISION,payload.applicationId]',
  'logical:Program->Notification[APPLICATION_DECISION_ACKNOWLEDGED,idempotencyKey]':
    'logical:Application->Notification[APPLICATION_DECISION_ACKNOWLEDGED,idempotencyKey]',
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
  PROGRAM_PURGE_DELETION_ORDER.map((step) => ({
    id: step.id,
    operation: step.operation,
    covers: step.covers
      .map(narrowCoverToTeam)
      .filter((relation): relation is string => relation !== null),
  })).filter((step) => step.covers.length > 0);
