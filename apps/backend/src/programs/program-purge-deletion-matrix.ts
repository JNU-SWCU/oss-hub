export type ProgramPurgeDeletionStep = {
  readonly id: string;
  readonly operation: 'DELETE' | 'DETACH' | 'TOMBSTONE' | 'PRESERVE';
  /** Prisma schema의 부모→자식 관계. 논리 자식은 `logical:` 접두사를 쓴다. */
  readonly covers: readonly string[];
};

/**
 * Program purge의 명시적인 bottom-up 삭제 순서.
 *
 * `DETACH`는 수집 자산 또는 파일 worker가 계속 소유해야 하는 행의 Program 산하 FK만
 * 해제한다. `TOMBSTONE`은 storageKey를 별도 삭제 대기 행으로 옮긴 뒤 원래 행을 지운다.
 * `PRESERVE`는 DETACH된 행(예: GithubRepository) 아래에 계속 매달려 있는, purge가
 * 절대 건드리지 않는 손자 행이다 — 부모가 삭제되지 않으니 이 행도 그대로 남아야
 * 맞는 것이지, 스키마 순회가 DETACH에서 멈춰 우연히 누락된 게 아니라는 것을
 * 명시적으로 선언한다. 이 목록은 schema child graph 회귀 테스트의 allowlist이기도 하다.
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
    // GithubRepository->RepositoryProvisionJob은 같은 행 집합을 가리키는 별도 edge다 —
    // repositoryId FK(nullable, GithubRepository는 detach만 되고 삭제되지 않음)를 통해서도
    // 도달 가능하지만, 실제 삭제는 이 프로그램의 Application으로 스코프한
    // deleteMany(where: { application: { programId } })가 GithubRepository detach보다
    // 먼저 실행돼 전량 삭제한다.
    covers: [
      'Application->RepositoryProvisionJob',
      'GithubRepository->RepositoryProvisionJob',
    ],
  },
  {
    id: 'github-repository-collection-descendants-preserved',
    operation: 'PRESERVE',
    // GithubRepository는 삭제되지 않고 program/application/team 연결만 해제된다 —
    // 이 손자 행들은 GithubRepository로의 FK가 그대로이므로 purge가 절대 건드리지 않고
    // 그대로 보존된다(수집 이력·초대 이력 유지).
    covers: [
      'GithubRepository->RepositoryInvitation',
      'GithubRepository->Contribution',
      'GithubRepository->CollectionRepositoryStream',
      'GithubRepository->CollectionCommitFact',
      'GithubRepository->CollectionPullRequestFact',
      'GithubRepository->CollectionReleaseFact',
    ],
  },
  {
    id: 'public-showcase-contributors',
    operation: 'DELETE',
    // PublicShowcaseRepository->PublicShowcaseContributor는 실제 FK가
    // onDelete: Cascade라 publicShowcaseRepository.deleteMany 한 번으로 DB가 대신 지운다
    // (코드에서 별도 deleteMany를 부르지 않는다 — migration
    // 20260726123000_add_public_showcase_projection에서 확인).
    covers: ['PublicShowcaseRepository->PublicShowcaseContributor'],
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
