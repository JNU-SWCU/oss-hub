export type ProgramPurgeDeletionStep = {
  readonly id: string;
  readonly operation: 'DELETE' | 'DETACH' | 'TOMBSTONE';
  /** Prisma schema의 부모→자식 관계. 논리 자식은 `logical:` 접두사를 쓴다. */
  readonly covers: readonly string[];
};

/**
 * Program purge의 명시적인 bottom-up 삭제 순서.
 *
 * `DETACH`는 수집 자산 또는 파일 worker가 계속 소유해야 하는 행의 Program 산하 FK만
 * 해제한다. `TOMBSTONE`은 storageKey를 별도 삭제 대기 행으로 옮긴 뒤 원래 행을 지운다.
 * 이 목록은 schema child graph 회귀 테스트의 allowlist이기도 하다.
 */
export const PROGRAM_PURGE_DELETION_ORDER = [
  {
    id: 'public-showcase-projections',
    operation: 'DELETE',
    covers: ['logical:Program->PublicShowcaseRepository'],
  },
  {
    id: 'program-outbox-events',
    operation: 'DELETE',
    covers: ['logical:Program->OutboxEvent'],
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
    covers: ['Application->RepositoryProvisionJob'],
  },
  {
    id: 'submission-files',
    operation: 'DETACH',
    covers: [
      'Milestone->SubmissionFile',
      'Application->SubmissionFile',
      'SubmissionRevision->SubmissionFile',
      'MilestoneDocumentSubmission->SubmissionFile',
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
    id: 'submission-reviews',
    operation: 'DELETE',
    covers: ['SubmissionRevision->Review'],
  },
  {
    id: 'submission-revisions',
    operation: 'DELETE',
    covers: ['Submission->SubmissionRevision'],
  },
  {
    id: 'submissions',
    operation: 'DELETE',
    covers: ['Milestone->Submission', 'Application->Submission'],
  },
  {
    id: 'milestone-document-review-histories',
    operation: 'DELETE',
    covers: ['MilestoneDocumentSubmission->MilestoneDocumentReviewHistory'],
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
] as const satisfies readonly ProgramPurgeDeletionStep[];
