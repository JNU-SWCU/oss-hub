import { ProgramDeletionScopeCounts } from '../domain/program-deletion-scope';
import { Prisma } from '@prisma/client';
import type { Prisma as PrismaTypes } from '@prisma/client';

type DeletionScopeCountsRow = Readonly<{
  applications: bigint;
  teams: bigint;
  boardPosts: bigint;
  submissions: bigint;
  submissionEvents: bigint;
  scopeFingerprint: string;
}>;

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
        (SELECT count(*) FROM "MilestoneDocumentSubmission" WHERE "milestoneDocumentId" IN (
            SELECT document.id
            FROM "MilestoneDocument" AS document
            INNER JOIN "Milestone" AS milestone ON milestone.id = document."milestoneId"
            WHERE milestone."programId" = ${programId}
          )) AS submissions,
        (
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
            ) OR (
              notification.type = 'TEAM_DELETED'
              AND notification.payload->>'programId' = ${programId}
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
