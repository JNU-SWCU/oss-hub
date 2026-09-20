export type PurgeDeletionStep = {
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
    id: 'application-review-histories',
    operation: 'DELETE',
    // Application->ApplicationReviewHistory는 FK가 `onDelete: Cascade`라
    // `application.deleteMany` 한 번으로 DB가 대슸 지운다(코드가 별도로
    // deleteMany를 부르지 않는다 — migration
    // 20260920030000_add_application_review_history에서 확인).
    //
    // 삭제 확인 화면의 별도 수치로는 사지 않는다. 이 행은 이밌 세는
    // `applications`에서 전적으로 파생되므로 「신청이 몇 건 사라진다」가 이미
    // 검토 이력이 함께 사라진다는 뜻이고, 반대로 이 id를 TOCTOU 지문에 넣으면
    // 동시에 들어오는 판정 하나가 무관한 삭제를 거부하게 된다 — 지문은 이미
    // Application 축에서 상태 변경을 범위 변경으로 보지 않는다.
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

/**
 * 팀 하나만 지울 때 실제로 부모가 되는 모델. `Program`·`Milestone`·`BoardPost`·
 * `ProgramCreateRequest`처럼 프로그램에 매달린 부모는 팀을 지운다고 사라지지 않으므로
 * 여기 없다 — 그 자식들은 팀 삭제가 건드릴 것이 아니다.
 */
const TEAM_SUBTREE_PARENTS: ReadonlySet<string> = new Set([
  'Team',
  'Application',
  'GithubRepository',
  'MilestoneDocumentSubmission',
  'MilestoneDocumentSubmissionHistory',
]);

/** 지워지는 팀 행 자체. 부모는 Program이지만 팀 삭제의 마지막 단계다. */
const TEAM_ROW_RELATION = 'Program->Team';

/**
 * 논리 자식은 부모 모델을 문자열로 적을 뿐이라 기계적으로 좁힐 수 없다. 같은 행을
 * 프로그램은 `programId`로, 팀은 그 팀의 `Application` id로 찾는다 — 도달 경로만 다르고
 * 대상은 같은 행이므로 여기서 팀 범위의 이름으로 바꿔 단다.
 *
 * 이 표에 없는 논리 자식은 Program에만 매달린 것이다. `DEADLINE_DIGEST`는
 * `prefix:date:programId:recipientId`로 프로그램 전 수신자에게 나가므로 팀 하나를
 * 지운다고 지울 수 없고, `PublicShowcaseRepository` projection은 `programId`로만 묶이며
 * 그 `repositoryId`가 가리키는 `GithubRepository`는 팀 삭제가 DETACH로 보존한다.
 *
 * `TEAM_DELETED`도 일부러 빼 둔다. 그 행은 팀 삭제가 **만드는** 것이니 같은 트랜잭션이
 * 다시 지우면 알림 자체가 사라진다. 프로그램 purge만 그것을 거둑다.
 */
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

/**
 * 교직원 팀 삭제의 삭제 순서. **새로 만들지 않는다** — 위 program purge 순서에서 팀에
 * 매달린 관계만 남겨 좁힌 것이고, 단계의 상대 순서와 operation은 그대로 물려받는다.
 * 그래서 팀 삭제가 program purge와 다른 순서로 갈라질 수 없다(`teams` 단계가 마지막인
 * 것, `applications`가 그보다 먼저인 것 모두 위 배열이 정한다).
 *
 * `GithubRepository`는 여기서도 DELETE가 아니라 DETACH다 — 수집 이력(Contribution·
 * CollectionCommitFact 등)이 그 아래 Cascade로 매달려 있어서, 저장소 행을 지우면 팀
 * 하나를 지우려다 전역 수집 자산이 함께 사라진다. 그 손자들은 `PRESERVE` 단계가
 * 「부모가 남으니 그대로 둔다」고 명시적으로 선언한다.
 */
export const TEAM_PURGE_DELETION_ORDER: readonly PurgeDeletionStep[] =
  PROGRAM_PURGE_DELETION_ORDER.map((step) => ({
    id: step.id,
    operation: step.operation,
    covers: step.covers
      .map(narrowCoverToTeam)
      .filter((relation): relation is string => relation !== null),
  })).filter((step) => step.covers.length > 0);
