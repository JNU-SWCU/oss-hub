import { Prisma } from '@prisma/client';
import type { Prisma as PrismaTypes } from '@prisma/client';

/** 팀 삭제 확인 화면(교직원 팀 상세)과 삭제 트랜잭션이 공유하는 팀 범위. */
export type TeamDeletionScopeCounts = {
  readonly applications: number;
  readonly members: number;
  readonly invitations: number;
  readonly submissions: number;
  /** 제출 헤더가 그대로여도 늘 수 있는 파일·제출 이력·검토 이력의 합계. */
  readonly submissionEvents: number;
  /**
   * 함께 지워지지 않고 **연결만 끊기는** 저장소 수. 수집 이력이 그 아래 Cascade로
   * 매달려 있어 행 자체는 보존한다 — 화면은 이 수를 「지워진다」가 아니라
   * 「연결이 끊긴다」로 말해야 한다.
   */
  readonly detachedRepositories: number;
  /** 삭제·분리 대상 전체 id 집합의 지문. */
  readonly scopeFingerprint: string;
};

type DeletionScopeCountsRow = Readonly<{
  applications: bigint;
  members: bigint;
  invitations: bigint;
  submissions: bigint;
  submissionEvents: bigint;
  detachedRepositories: bigint;
  scopeFingerprint: string;
}>;

/**
 * 한 SQL 문장의 snapshot으로 팀 삭제 범위를 읽는다.
 *
 * `program-deletion-scope.ts`와 같은 이유로 확인 화면과 삭제 트랜잭션이 **같은 쿼리**를
 * 공유한다 — 두 곳이 각자 count를 세면 문장이 갈라질 여지가 생기고, 그 틈이 다시
 * TOCTOU가 된다(#F2). 호출자는 반드시 같은 트랜잭션의 `TransactionClient`를 넘겨
 * 단일 스냅샷을 보장해야 한다.
 *
 * 범위는 `TEAM_PURGE_DELETION_ORDER`가 덮는 관계와 정확히 같아야 한다 — 세는 것과
 * 지우는 것이 어긋나면 재확인이 통과한 뒤에 사후 대조가 터진다.
 */
export async function readTeamDeletionScopeCounts(
  transaction: PrismaTypes.TransactionClient,
  teamId: string,
): Promise<TeamDeletionScopeCounts> {
  const [row] = await transaction.$queryRaw<readonly DeletionScopeCountsRow[]>(
    Prisma.sql`
      WITH team_application AS (
        SELECT id FROM "Application" WHERE "teamId" = ${teamId}
      ),
      team_submission AS (
        SELECT document_submission.id
        FROM "MilestoneDocumentSubmission" AS document_submission
        WHERE document_submission."applicationId" IN (SELECT id FROM team_application)
      ),
      team_submission_history AS (
        SELECT history.id
        FROM "MilestoneDocumentSubmissionHistory" AS history
        WHERE history."milestoneDocumentSubmissionId" IN (SELECT id FROM team_submission)
      ),
      team_review_history AS (
        SELECT review.id
        FROM "MilestoneDocumentReviewHistory" AS review
        WHERE review."milestoneDocumentSubmissionId" IN (SELECT id FROM team_submission)
      ),
      team_submission_file AS (
        SELECT file.id
        FROM "SubmissionFile" AS file
        WHERE file."applicationId" IN (SELECT id FROM team_application)
          OR file."milestoneDocumentSubmissionId" IN (SELECT id FROM team_submission)
          OR file."milestoneDocumentSubmissionHistoryId" IN (SELECT id FROM team_submission_history)
      ),
      team_repository AS (
        SELECT
          repository.id,
          repository."programId",
          repository."applicationId",
          repository."teamId"
        FROM "GithubRepository" AS repository
        WHERE repository."teamId" = ${teamId}
          OR repository."applicationId" IN (SELECT id FROM team_application)
      ),
      team_provision_job AS (
        -- 저장소를 거치는 별도 edge를 두지 않는다 — RepositoryProvisionJob.applicationId는
        -- 필수+unique라 이 조건 하나로 빠짐이 없고, 지문과 실제 삭제가 같은 집합을
        -- 가리켜야 「센 것」과 「지운 것」이 갈라지지 않는다.
        SELECT job.id
        FROM "RepositoryProvisionJob" AS job
        WHERE job."applicationId" IN (SELECT id FROM team_application)
      ),
      team_outbox_event AS (
        SELECT event.id
        FROM "OutboxEvent" AS event
        WHERE event."aggregateType" = 'Application'
          AND event."aggregateId" IN (SELECT id FROM team_application)
      ),
      team_decision_notification AS (
        SELECT notification.id
        FROM "Notification" AS notification
        WHERE notification.type = 'APPLICATION_DECISION'
          AND notification.payload->>'applicationId' IN (SELECT id FROM team_application)
      ),
      team_notification AS (
        SELECT id FROM team_decision_notification
        UNION ALL
        SELECT acknowledgement.id
        FROM "Notification" AS acknowledgement
        WHERE acknowledgement.type = 'APPLICATION_DECISION_ACKNOWLEDGED'
          AND acknowledgement."idempotencyKey" IN (
            SELECT CONCAT('application-decision-acknowledged:', id)
            FROM team_decision_notification
          )
      )
      SELECT
        (SELECT count(*) FROM team_application) AS applications,
        (SELECT count(*) FROM "TeamMember" WHERE "teamId" = ${teamId}) AS members,
        (SELECT count(*) FROM "TeamInvitation" WHERE "teamId" = ${teamId}) AS invitations,
        (SELECT count(*) FROM team_submission) AS submissions,
        (
          (SELECT count(*) FROM team_submission_file)
          + (SELECT count(*) FROM team_submission_history)
          + (SELECT count(*) FROM team_review_history)
        ) AS "submissionEvents",
        (SELECT count(*) FROM team_repository) AS "detachedRepositories",
        (
          SELECT MD5(COALESCE(STRING_AGG(scope."key", '|' ORDER BY scope."key"), ''))
          FROM (
            SELECT CONCAT('Application:', id) AS "key" FROM team_application
            UNION ALL
            SELECT CONCAT('TeamMember:', id) FROM "TeamMember" WHERE "teamId" = ${teamId}
            UNION ALL
            SELECT CONCAT('TeamInvitation:', id) FROM "TeamInvitation" WHERE "teamId" = ${teamId}
            UNION ALL
            SELECT CONCAT('MilestoneDocumentSubmission:', id) FROM team_submission
            UNION ALL
            SELECT CONCAT('MilestoneDocumentSubmissionHistory:', id) FROM team_submission_history
            UNION ALL
            SELECT CONCAT('MilestoneDocumentReviewHistory:', id) FROM team_review_history
            UNION ALL
            SELECT CONCAT('SubmissionFile:', id) FROM team_submission_file
            UNION ALL
            SELECT CONCAT('RepositoryProvisionJob:', id) FROM team_provision_job
            UNION ALL
            SELECT CONCAT(
              'GithubRepository:', repository.id, ':',
              COALESCE(repository."programId", ''), ':',
              COALESCE(repository."applicationId", ''), ':',
              COALESCE(repository."teamId", '')
            )
            FROM team_repository AS repository
            UNION ALL
            SELECT CONCAT('OutboxEvent:', id) FROM team_outbox_event
            UNION ALL
            SELECT CONCAT('Notification:', id) FROM team_notification
          ) AS scope
        ) AS "scopeFingerprint"
    `,
  );
  if (!row)
    throw new Error('Team deletion scope count query returned no result.');
  return {
    applications: Number(row.applications),
    members: Number(row.members),
    invitations: Number(row.invitations),
    submissions: Number(row.submissions),
    submissionEvents: Number(row.submissionEvents),
    detachedRepositories: Number(row.detachedRepositories),
    scopeFingerprint: row.scopeFingerprint,
  };
}

export function sameTeamDeletionScopeCounts(
  left: TeamDeletionScopeCounts,
  right: TeamDeletionScopeCounts,
): boolean {
  return (
    sameTeamDeletionScopeCountValues(left, right) &&
    left.scopeFingerprint === right.scopeFingerprint
  );
}

/** 삭제 결과는 id를 잃었으므로 화면에 보인 수치만 확인된 범위와 대조한다. */
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
