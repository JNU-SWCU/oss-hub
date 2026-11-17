export const AUDIT_CATEGORIES = [
  'ACCOUNT',
  'OPERATION',
  'SUBMISSION',
  'LOGIN',
  'SYSTEM',
] as const;

export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export type AuditSourceKey =
  'ACCOUNT' | 'TEAM' | 'PROGRAM' | 'SUBMISSION' | 'LOGIN';

export const AUDIT_SOURCE_QUERIES: Readonly<Record<AuditSourceKey, string>> = {
  ACCOUNT: `
    SELECT event.*,
      CASE WHEN event."targetType" IN ('PROGRAM', 'TEAM', 'APPLICATION', 'REPOSITORY')
        THEN 'OPERATION' ELSE 'ACCOUNT' END AS "category"
    FROM (
      WITH histories AS (
        SELECT "id", "userId", "actorId", "event"::text, "occurredAt",
          "sourceTable", "sourceId", "sourcePart", "data"
        FROM "UserHistory"
        UNION ALL
        SELECT "id", "userId", "actorId", "event"::text, "occurredAt",
          "sourceTable", "sourceId", "sourcePart", "data"
        FROM "AdminHistory"
      ), imported AS (
        SELECT DISTINCT ON ("sourceId") "sourceId" AS "id", "userId", "actorId",
          "occurredAt", "data"->'original' AS "original"
        FROM histories
        WHERE "event" = 'LEGACY_IMPORT' AND "sourceTable" = 'AuditLog'
          AND "sourceId" IS NOT NULL
          AND "data"->>'schemaVersion' = '1'
          AND "data"->>'recordKind' = 'AUDIT_EVENT'
        ORDER BY "sourceId", "sourcePart", "id"
      )
      SELECT "id", 'ACCOUNT' AS "source", "actorId", "occurredAt",
        "original"->>'action' AS "action",
        "original"->>'targetType' AS "targetType",
        "original"->>'targetId' AS "targetId",
        "original"->'metadata' AS "metadata",
        NULL::text AS "historyKind",
        NULL::text AS "programId",
        NULL::text AS "teamId",
        "userId" AS "subjectUserId",
        COALESCE("original"->>'requestId', "original"#>>'{metadata,requestId}')
          AS "requestId"
      FROM imported
      UNION ALL
      SELECT "id", 'ACCOUNT', "actorId", "occurredAt",
        CASE "data"->>'recordKind'
          WHEN 'DOMAIN_EVENT' THEN "data"->>'action'
          WHEN 'BOOTSTRAP' THEN CASE "event"
            WHEN 'GRANTED' THEN 'GRANT_ADMIN_ACCESS'
            WHEN 'REVOKED' THEN 'REVOKE_ADMIN_ACCESS'
            ELSE "event" END
          WHEN 'TYPE_SELECTION' THEN 'USER_ROLE_CHANGED'
          ELSE "event" END,
        CASE "data"->>'recordKind'
          WHEN 'DOMAIN_EVENT' THEN "data"->>'targetType'
          WHEN 'REQUEST_TRANSITION' THEN 'ROLE_REQUEST'
          ELSE 'USER' END,
        CASE "data"->>'recordKind'
          WHEN 'DOMAIN_EVENT' THEN "data"->>'targetId'
          WHEN 'REQUEST_TRANSITION' THEN "data"#>>'{request,id}'
          ELSE "userId" END,
        CASE "data"->>'recordKind'
          WHEN 'DOMAIN_EVENT' THEN "data"->'metadata'
          ELSE "data" END,
        CASE WHEN "data"->>'recordKind' = 'DOMAIN_EVENT' THEN NULL
          ELSE "data"->>'recordKind' END,
        NULL::text,
        NULL::text,
        "userId",
        COALESCE("data"->>'requestId', "data"#>>'{metadata,requestId}',
          CASE WHEN "data"->>'recordKind' = 'REQUEST_TRANSITION'
            THEN "data"#>>'{request,id}' END)
      FROM histories
      WHERE "event" <> 'LEGACY_IMPORT'
        AND "data"->>'schemaVersion' = '1'
        AND "data"->>'recordKind' IN ('DOMAIN_EVENT', 'REQUEST_TRANSITION', 'SIGNUP', 'BOOTSTRAP', 'TYPE_SELECTION')
    ) event
  `,
  TEAM: `
      SELECT history."id", 'TEAM' AS "source", history."actorId",
        history."occurredAt",
        COALESCE(history."data"->>'action', CASE history."event"::text
          WHEN 'CREATED' THEN 'TEAM_CREATED'
          WHEN 'JOINED' THEN 'TEAM_JOINED'
          WHEN 'RENAMED' THEN 'TEAM_RENAMED'
          WHEN 'DELETED' THEN 'TEAM_DELETED'
          WHEN 'MEMBER_LEFT' THEN 'TEAM_MEMBERSHIP_CHANGED'
          WHEN 'MEMBER_REMOVED' THEN 'TEAM_MEMBERSHIP_CHANGED'
          WHEN 'LEADER_TRANSFERRED' THEN 'TEAM_MEMBERSHIP_CHANGED'
          WHEN 'REPOSITORY_PUBLISHED' THEN 'REPOSITORY_PUBLISHED'
          ELSE 'APPLICATION_' || history."event"::text END) AS "action",
        COALESCE(history."data"->>'targetType',
          CASE WHEN history."data"->>'applicationId' IS NOT NULL
            THEN 'APPLICATION' ELSE 'TEAM' END) AS "targetType",
        COALESCE(history."data"->>'targetId', history."data"->>'applicationId',
          history."teamId") AS "targetId",
        COALESCE(history."data"->'metadata', history."data"->'pairedAuditMetadata',
          jsonb_strip_nulls(jsonb_build_object(
            'schemaVersion', 1,
            'programName', program."name",
            'teamName', COALESCE(history."data"->>'name', team."name"),
            'previousName', history."data"->>'previousName',
            'operation', CASE history."event"::text
              WHEN 'MEMBER_LEFT' THEN 'LEAVE'
              WHEN 'MEMBER_REMOVED' THEN 'REMOVE'
              WHEN 'LEADER_TRANSFERRED' THEN 'TRANSFER_LEADER' END,
            'removedUserId', history."data"->>'removedUserId',
            'previousLeaderId', history."data"->>'previousLeaderId'))
          || CASE WHEN history."data" ? 'nextLeaderId'
            THEN jsonb_build_object('nextLeaderId', history."data"->'nextLeaderId')
            ELSE '{}'::jsonb END) AS "metadata",
        NULL::text AS "historyKind",
        history."programId",
        history."teamId",
        NULL::text AS "subjectUserId",
        COALESCE(history."data"->>'requestId',
          history."data"#>>'{metadata,requestId}',
          history."data"#>>'{pairedAuditMetadata,requestId}') AS "requestId",
        'OPERATION' AS "category"
      FROM "TeamHistory" history
      LEFT JOIN "Program" program ON program."id" = history."programId"
      LEFT JOIN "Team" team ON team."id" = history."teamId"
      WHERE history."event"::text NOT LIKE 'INVITATION%'
  `,
  PROGRAM: `
    SELECT history."id", 'PROGRAM' AS "source", history."actorId",
      history."occurredAt", 'PROGRAM_' || history."event"::text AS "action",
      'PROGRAM' AS "targetType", history."programId" AS "targetId",
      history."data"->'metadata' AS "metadata", NULL::text AS "historyKind",
      history."programId", NULL::text AS "teamId",
      NULL::text AS "subjectUserId",
      COALESCE(history."data"->>'requestId', history."data"#>>'{metadata,requestId}')
        AS "requestId",
      'OPERATION' AS "category"
    FROM "ProgramHistory" history
  `,
  SUBMISSION: `
    SELECT history."id", 'SUBMISSION' AS "source", history."actorId",
      history."createdAt" AS "occurredAt",
      'SUBMISSION_' || history."event"::text AS "action",
      'SUBMISSION' AS "targetType", history."submissionId" AS "targetId",
      jsonb_strip_nulls(jsonb_build_object(
        'schemaVersion', 1,
        'requirementName', requirement."name",
        'revision', history."revision")) AS "metadata",
      NULL::text AS "historyKind", milestone."programId",
      submission."teamId", NULL::text AS "subjectUserId",
      NULL::text AS "requestId", 'SUBMISSION' AS "category"
    FROM "SubmissionHistory" history
    JOIN "Submission" submission ON submission."id" = history."submissionId"
    JOIN "Requirement" requirement ON requirement."id" = submission."requirementId"
    JOIN "Milestone" milestone ON milestone."id" = requirement."milestoneId"
  `,
  LOGIN: `
    SELECT history."id", 'LOGIN' AS "source", history."userId" AS "actorId",
      history."loginAt" AS "occurredAt",
      CASE WHEN history."success" THEN history."event"::text
        ELSE history."event"::text || '_FAILED' END AS "action",
      'USER' AS "targetType", history."userId" AS "targetId",
      jsonb_build_object('schemaVersion', 1, 'provider', history."provider")
        AS "metadata",
      NULL::text AS "historyKind", NULL::text AS "programId",
      NULL::text AS "teamId", history."userId" AS "subjectUserId",
      NULL::text AS "requestId", 'LOGIN' AS "category"
    FROM "LoginHistory" history
  `,
};
