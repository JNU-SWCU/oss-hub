import { Prisma } from '@prisma/client';
import type { Prisma as PrismaTypes } from '@prisma/client';

/** 삭제 확인 화면(GET edit)과 purge 트랜잭션이 공유하는 자식 범위. */
export type ProgramDeletionScopeCounts = {
  readonly applications: number;
  readonly teams: number;
  readonly boardPosts: number;
  readonly submissions: number;
  /** 제출 헤더가 그대로여도 늘 수 있는 리비전·검토·파일·항목 이력의 합계. */
  readonly submissionEvents: number;
  /** 삭제·분리·tombstone 대상 전체 id 집합의 지문. */
  readonly scopeFingerprint: string;
};

type DeletionScopeCountsRow = Readonly<{
  applications: bigint;
  teams: bigint;
  boardPosts: bigint;
  submissions: bigint;
  submissionEvents: bigint;
  scopeFingerprint: string;
}>;

/**
 * 한 SQL 문장의 snapshot으로 삭제 범위를 읽는다.
 *
 * `program-editor.repository.ts`(GET edit 확인 화면)와 `program-lifecycle.service.ts`
 * (purge 트랜잭션의 재확인)가 **같은 쿼리**를 공유한다 — 두 곳이 각자 count를 세면 문장이
 * 갈라질 여지가 생기고, 그 틈이 다시 TOCTOU가 된다(#F2). 호출자는 반드시 같은 트랜잭션의
 * `TransactionClient`를 넘겨 단일 스냅샷을 보장해야 한다.
 */
export async function readProgramDeletionScopeCounts(
  transaction: PrismaTypes.TransactionClient,
  programId: string,
): Promise<ProgramDeletionScopeCounts> {
  const [row] = await transaction.$queryRaw<readonly DeletionScopeCountsRow[]>(
    Prisma.sql`
      SELECT
        (SELECT count(*) FROM "Application" WHERE "programId" = ${programId}) AS applications,
        (SELECT count(*) FROM "Team" WHERE "programId" = ${programId}) AS teams,
        (SELECT count(*) FROM "BoardPost" WHERE "programId" = ${programId}) AS "boardPosts",
        (
          (SELECT count(*) FROM "Submission" WHERE "milestoneId" IN (
            SELECT id FROM "Milestone" WHERE "programId" = ${programId}
          ))
          +
          (SELECT count(*) FROM "MilestoneDocumentSubmission" WHERE "milestoneDocumentId" IN (
            SELECT document.id
            FROM "MilestoneDocument" AS document
            INNER JOIN "Milestone" AS milestone ON milestone.id = document."milestoneId"
            WHERE milestone."programId" = ${programId}
          ))
        ) AS submissions,
        (
          (SELECT count(*) FROM "SubmissionRevision" WHERE "submissionId" IN (
            SELECT submission.id
            FROM "Submission" AS submission
            INNER JOIN "Milestone" AS milestone ON milestone.id = submission."milestoneId"
            WHERE milestone."programId" = ${programId}
          ))
          +
          (SELECT count(*) FROM "Review" WHERE "submissionRevisionId" IN (
            SELECT revision.id
            FROM "SubmissionRevision" AS revision
            INNER JOIN "Submission" AS submission ON submission.id = revision."submissionId"
            INNER JOIN "Milestone" AS milestone ON milestone.id = submission."milestoneId"
            WHERE milestone."programId" = ${programId}
          ))
          +
          (SELECT count(*) FROM "SubmissionFile" WHERE
            "applicationId" IN (SELECT id FROM "Application" WHERE "programId" = ${programId})
            OR "milestoneId" IN (SELECT id FROM "Milestone" WHERE "programId" = ${programId})
            OR "milestoneDocumentSubmissionHistoryId" IN (
              SELECT history.id
              FROM "MilestoneDocumentSubmissionHistory" AS history
              INNER JOIN "MilestoneDocumentSubmission" AS document_submission
                ON document_submission.id = history."milestoneDocumentSubmissionId"
              INNER JOIN "MilestoneDocument" AS document
                ON document.id = document_submission."milestoneDocumentId"
              INNER JOIN "Milestone" AS milestone
                ON milestone.id = document."milestoneId"
              WHERE milestone."programId" = ${programId}
            )
          )
          +
          (SELECT count(*) FROM "MilestoneDocumentSubmissionHistory" WHERE "milestoneDocumentSubmissionId" IN (
            SELECT document_submission.id
            FROM "MilestoneDocumentSubmission" AS document_submission
            INNER JOIN "MilestoneDocument" AS document ON document.id = document_submission."milestoneDocumentId"
            INNER JOIN "Milestone" AS milestone ON milestone.id = document."milestoneId"
            WHERE milestone."programId" = ${programId}
          ))
          +
          (SELECT count(*) FROM "MilestoneDocumentReviewHistory" WHERE "milestoneDocumentSubmissionId" IN (
            SELECT document_submission.id
            FROM "MilestoneDocumentSubmission" AS document_submission
            INNER JOIN "MilestoneDocument" AS document ON document.id = document_submission."milestoneDocumentId"
            INNER JOIN "Milestone" AS milestone ON milestone.id = document."milestoneId"
            WHERE milestone."programId" = ${programId}
          ))
        ) AS "submissionEvents",
        (
          SELECT MD5(COALESCE(STRING_AGG(scope."key", '|' ORDER BY scope."key"), ''))
          FROM (
            SELECT CONCAT('Application:', id) AS "key"
            FROM "Application" WHERE "programId" = ${programId}
            UNION ALL
            SELECT CONCAT('Team:', id) FROM "Team" WHERE "programId" = ${programId}
            UNION ALL
            SELECT CONCAT('TeamMember:', id) FROM "TeamMember" WHERE "programId" = ${programId}
            UNION ALL
            SELECT CONCAT('TeamInvitation:', id) FROM "TeamInvitation" WHERE "programId" = ${programId}
            UNION ALL
            SELECT CONCAT('BoardPost:', id) FROM "BoardPost" WHERE "programId" = ${programId}
            UNION ALL
            SELECT CONCAT('BoardComment:', comment.id)
            FROM "BoardComment" AS comment
            INNER JOIN "BoardPost" AS post ON post.id = comment."postId"
            WHERE post."programId" = ${programId}
            UNION ALL
            SELECT CONCAT('Milestone:', id) FROM "Milestone" WHERE "programId" = ${programId}
            UNION ALL
            SELECT CONCAT('MilestoneDocument:', document.id)
            FROM "MilestoneDocument" AS document
            INNER JOIN "Milestone" AS milestone ON milestone.id = document."milestoneId"
            WHERE milestone."programId" = ${programId}
            UNION ALL
            SELECT CONCAT('MilestoneDocumentTemplateFile:', file.id)
            FROM "MilestoneDocumentTemplateFile" AS file
            INNER JOIN "MilestoneDocument" AS document ON document.id = file."milestoneDocumentId"
            INNER JOIN "Milestone" AS milestone ON milestone.id = document."milestoneId"
            WHERE milestone."programId" = ${programId}
            UNION ALL
            SELECT CONCAT('Submission:', submission.id)
            FROM "Submission" AS submission
            INNER JOIN "Milestone" AS milestone ON milestone.id = submission."milestoneId"
            WHERE milestone."programId" = ${programId}
            UNION ALL
            SELECT CONCAT('SubmissionRevision:', revision.id)
            FROM "SubmissionRevision" AS revision
            INNER JOIN "Submission" AS submission ON submission.id = revision."submissionId"
            INNER JOIN "Milestone" AS milestone ON milestone.id = submission."milestoneId"
            WHERE milestone."programId" = ${programId}
            UNION ALL
            SELECT CONCAT('Review:', review.id)
            FROM "Review" AS review
            INNER JOIN "SubmissionRevision" AS revision ON revision.id = review."submissionRevisionId"
            INNER JOIN "Submission" AS submission ON submission.id = revision."submissionId"
            INNER JOIN "Milestone" AS milestone ON milestone.id = submission."milestoneId"
            WHERE milestone."programId" = ${programId}
            UNION ALL
            SELECT CONCAT('MilestoneDocumentSubmission:', document_submission.id)
            FROM "MilestoneDocumentSubmission" AS document_submission
            INNER JOIN "MilestoneDocument" AS document ON document.id = document_submission."milestoneDocumentId"
            INNER JOIN "Milestone" AS milestone ON milestone.id = document."milestoneId"
            WHERE milestone."programId" = ${programId}
            UNION ALL
            SELECT CONCAT('MilestoneDocumentSubmissionHistory:', history.id)
            FROM "MilestoneDocumentSubmissionHistory" AS history
            INNER JOIN "MilestoneDocumentSubmission" AS document_submission
              ON document_submission.id = history."milestoneDocumentSubmissionId"
            INNER JOIN "MilestoneDocument" AS document ON document.id = document_submission."milestoneDocumentId"
            INNER JOIN "Milestone" AS milestone ON milestone.id = document."milestoneId"
            WHERE milestone."programId" = ${programId}
            UNION ALL
            SELECT CONCAT('MilestoneDocumentReviewHistory:', review.id)
            FROM "MilestoneDocumentReviewHistory" AS review
            INNER JOIN "MilestoneDocumentSubmission" AS document_submission
              ON document_submission.id = review."milestoneDocumentSubmissionId"
            INNER JOIN "MilestoneDocument" AS document ON document.id = document_submission."milestoneDocumentId"
            INNER JOIN "Milestone" AS milestone ON milestone.id = document."milestoneId"
            WHERE milestone."programId" = ${programId}
            UNION ALL
            SELECT CONCAT('SubmissionFile:', file.id)
            FROM "SubmissionFile" AS file
            WHERE file."applicationId" IN (
              SELECT id FROM "Application" WHERE "programId" = ${programId}
            ) OR file."milestoneId" IN (
              SELECT id FROM "Milestone" WHERE "programId" = ${programId}
            ) OR file."milestoneDocumentSubmissionHistoryId" IN (
              SELECT history.id
              FROM "MilestoneDocumentSubmissionHistory" AS history
              INNER JOIN "MilestoneDocumentSubmission" AS document_submission
                ON document_submission.id = history."milestoneDocumentSubmissionId"
              INNER JOIN "MilestoneDocument" AS document ON document.id = document_submission."milestoneDocumentId"
              INNER JOIN "Milestone" AS milestone ON milestone.id = document."milestoneId"
              WHERE milestone."programId" = ${programId}
            )
            UNION ALL
            SELECT CONCAT('ProgramCreateRequest:', request.id)
            FROM "ProgramCreateRequest" AS request WHERE request."programId" = ${programId}
            UNION ALL
            SELECT CONCAT('ProgramAuthoringUpload:', upload.id)
            FROM "ProgramAuthoringUpload" AS upload
            INNER JOIN "ProgramCreateRequest" AS request
              ON request.id = upload."createRequestId"
              AND request."actorId" = upload."createRequestActorId"
            WHERE request."programId" = ${programId}
            UNION ALL
            SELECT CONCAT('RepositoryProvisionJob:', job.id)
            FROM "RepositoryProvisionJob" AS job
            INNER JOIN "Application" AS application ON application.id = job."applicationId"
            WHERE application."programId" = ${programId}
            UNION ALL
            SELECT CONCAT(
              'GithubRepository:', repository.id, ':',
              COALESCE(repository."programId", ''), ':',
              COALESCE(repository."applicationId", ''), ':',
              COALESCE(repository."teamId", '')
            )
            FROM "GithubRepository" AS repository
            WHERE repository."programId" = ${programId}
              OR repository."applicationId" IN (
                SELECT id FROM "Application" WHERE "programId" = ${programId}
              )
              OR repository."teamId" IN (
                SELECT id FROM "Team" WHERE "programId" = ${programId}
              )
            UNION ALL
            SELECT CONCAT('PublicShowcaseRepository:', showcase."repositoryId")
            FROM "PublicShowcaseRepository" AS showcase WHERE showcase."programId" = ${programId}
            UNION ALL
            SELECT CONCAT('PublicShowcaseContributor:', contributor.id)
            FROM "PublicShowcaseContributor" AS contributor
            INNER JOIN "PublicShowcaseRepository" AS showcase
              ON showcase."repositoryId" = contributor."repositoryId"
            WHERE showcase."programId" = ${programId}
            UNION ALL
            SELECT CONCAT('OutboxEvent:', event.id)
            FROM "OutboxEvent" AS event
            WHERE (event."aggregateType" = 'PROGRAM' AND event."aggregateId" = ${programId})
              OR (event."aggregateType" = 'Application' AND event."aggregateId" IN (
                SELECT id FROM "Application" WHERE "programId" = ${programId}
              ))
            UNION ALL
            SELECT CONCAT('Notification:', notification.id)
            FROM "Notification" AS notification
            WHERE (
              notification.type = 'APPLICATION_DECISION'
              AND notification.payload->>'programId' = ${programId}
            ) OR (
              notification.type = 'APPLICATION_DECISION_ACKNOWLEDGED'
              AND notification."idempotencyKey" IN (
                SELECT CONCAT('application-decision-acknowledged:', decision.id)
                FROM "Notification" AS decision
                WHERE decision.type = 'APPLICATION_DECISION'
                  AND decision.payload->>'programId' = ${programId}
              )
            ) OR (
              notification.type = 'DEADLINE_DIGEST'
              AND notification."idempotencyKey" LIKE CONCAT('%:', ${programId}, ':%')
            )
          ) AS scope
        ) AS "scopeFingerprint"
    `,
  );
  if (!row) throw new Error('Deletion scope count query returned no result.');
  return {
    applications: Number(row.applications),
    teams: Number(row.teams),
    boardPosts: Number(row.boardPosts),
    submissions: Number(row.submissions),
    submissionEvents: Number(row.submissionEvents),
    scopeFingerprint: row.scopeFingerprint,
  };
}

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

/** 삭제 결과는 id를 잃었으므로 화면 요약에 보인 다섯 수치만 현재 snapshot과 대조한다. */
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
