import { TeamDeletionScopeCounts } from '../domain/team-deletion-scope';
import { Prisma } from '@prisma/client';
import type { Prisma as PrismaTypes } from '@prisma/client';

type DeletionScopeCountsRow = Readonly<{
  applications: bigint;
  members: bigint;
  invitations: bigint;
  submissions: bigint;
  submissionEvents: bigint;
  detachedRepositories: bigint;
  scopeFingerprint: string;
}>;

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
