import { SubmissionStatus } from '@prisma/client';

export const MATRIX_APPLICATION_MODES = ['PERSONAL', 'TEAM'] as const;
export const MATRIX_CELL_STATUSES = [
  'NOT_SUBMITTED',
  SubmissionStatus.SUBMITTED,
  SubmissionStatus.CHANGES_REQUESTED,
  SubmissionStatus.REJECTED,
  SubmissionStatus.APPROVED,
] as const;

const SUBMISSION_DASHBOARD_CELL_WORST = `
  MIN(CASE submission."status"::text
    WHEN 'REJECTED' THEN 0
    WHEN 'CHANGES_REQUESTED' THEN 1
    WHEN 'SUBMITTED' THEN 3
    WHEN 'APPROVED' THEN 4
    ELSE 2
  END)
`;
export const SUBMISSION_DASHBOARD_STAGE_COUNT_CTES = `
      teams AS (
        SELECT team."id", team."programId"
        FROM "Team" AS team
        JOIN program_ids USING ("programId")
        WHERE team."status" = 'APPROVED'
          AND team."archivedAt" IS NULL
      ),
      documents AS (
        SELECT requirement."id", requirement."milestoneId", milestones."programId"
        FROM "Requirement" AS requirement
        JOIN milestones ON milestones."id" = requirement."milestoneId"
        WHERE requirement."required"
      ),
      cells AS (
        SELECT
          documents."milestoneId",
          teams."id" AS "teamId",
          BOOL_AND(submission."id" IS NOT NULL) AS "fullySubmitted",
          ${SUBMISSION_DASHBOARD_CELL_WORST} AS worst
        FROM teams
        JOIN documents ON documents."programId" = teams."programId"
        LEFT JOIN "Submission" AS submission
          ON submission."teamId" = teams."id"
          AND submission."requirementId" = documents."id"
        GROUP BY documents."milestoneId", teams."id"
      ),
      milestone_counts AS (
        SELECT
          applicable."milestoneId",
          COUNT(cells."teamId")::int AS "totalTeams",
          COUNT(*) FILTER (WHERE cells."fullySubmitted")::int AS "submittedTeams",
          COUNT(*) FILTER (WHERE cells.worst = 2)::int AS "notSubmitted",
          COUNT(*) FILTER (WHERE cells.worst = 3)::int AS submitted,
          COUNT(*) FILTER (WHERE cells.worst = 4)::int AS approved,
          COUNT(*) FILTER (WHERE cells.worst = 1)::int AS "changesRequested",
          COUNT(*) FILTER (WHERE cells.worst = 0)::int AS rejected
        FROM (SELECT DISTINCT "milestoneId" FROM documents) AS applicable
        LEFT JOIN cells USING ("milestoneId")
        GROUP BY applicable."milestoneId"
      )
`;
