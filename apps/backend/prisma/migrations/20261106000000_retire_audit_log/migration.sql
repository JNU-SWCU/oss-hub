BEGIN;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL lock_timeout = '5s';

-- The previous image may have written AuditLog rows after the copy migration.
-- Route and copy every row again, reconcile, and drop the table only when nothing is missing.
-- Any failure raises before the DROP, so no row is deleted.
LOCK TABLE "AuditLog" IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE audit_log_route ON COMMIT DROP AS
-- audit-log-route:start
WITH facts AS (
  SELECT a.id, a.action, a."targetType", a."targetId", a."actorId", a."occurredAt", a.metadata,
    team.id IS NOT NULL AS team_live,
    team."programId" AS team_program_id,
    program.id IS NOT NULL AS program_live,
    repository.id IS NOT NULL AS repository_live,
    repository_team.id AS repository_team_id,
    repository_team."programId" AS repository_program_id,
    target_user.id IS NOT NULL AS user_live,
    EXISTS (
      SELECT 1 FROM program_team_backup.application_team_map map
      WHERE map."applicationId" = a."targetId"
    ) AS application_mapped,
    EXISTS (
      SELECT 1 FROM "TeamHistory" history
      WHERE (history."sourceTable" = 'AuditLog' AND history."sourceId" = a.id)
        OR history.data->>'pairedAuditId' = a.id
    ) AS in_team_history,
    EXISTS (
      SELECT 1 FROM "UserHistory" history
      WHERE history."sourceTable" = 'AuditLog' AND history."sourceId" = a.id
    ) OR EXISTS (
      SELECT 1 FROM "AdminHistory" history
      WHERE history."sourceTable" = 'AuditLog' AND history."sourceId" = a.id
    ) AS imported,
    named.matches AS program_name_matches,
    named.program_id AS named_program_id
  FROM "AuditLog" a
  LEFT JOIN "Team" team ON a."targetType" = 'TEAM' AND team.id = a."targetId"
  LEFT JOIN "Program" program ON a."targetType" = 'PROGRAM' AND program.id = a."targetId"
  LEFT JOIN "GithubRepository" repository ON a."targetType" = 'REPOSITORY' AND repository.id = a."targetId"
  LEFT JOIN "Team" repository_team ON repository_team.id = repository."teamId"
  LEFT JOIN "User" target_user ON a."targetType" = 'USER' AND target_user.id = a."targetId"
  CROSS JOIN LATERAL (
    SELECT count(*) AS matches, min(candidate.id) AS program_id
    FROM "Program" candidate WHERE candidate.name = a.metadata->>'programName'
  ) named
), routed AS (
  SELECT facts.*,
    CASE "targetType"
      WHEN 'APPLICATION' THEN CASE
        WHEN in_team_history THEN 'ALREADY_IN_TEAM_HISTORY'
        WHEN application_mapped THEN 'ABORT_APPLICATION_NOT_COPIED'
        ELSE 'DELETE_NO_TARGET' END
      WHEN 'TEAM' THEN CASE
        WHEN team_live AND action IN ('TEAM_CREATED', 'TEAM_JOINED', 'TEAM_RENAMED') THEN 'MIGRATE_TEAM'
        WHEN team_live AND action = 'TEAM_MEMBERSHIP_CHANGED'
          AND metadata->>'operation' IN ('LEAVE', 'REMOVE', 'TRANSFER_LEADER') THEN 'MIGRATE_TEAM'
        WHEN team_live THEN 'UNROUTED'
        WHEN action = 'TEAM_DELETED' AND program_name_matches = 1 THEN 'MIGRATE_TEAM_DELETED_EVENT'
        WHEN action = 'TEAM_DELETED' THEN 'DELETE_TEAM_DELETED_UNRESOLVED'
        ELSE 'DELETE_NO_TARGET' END
      WHEN 'PROGRAM' THEN CASE
        WHEN action = 'PROGRAM_DELETED' THEN 'MIGRATE_PROGRAM_DELETED_EVENT'
        WHEN NOT program_live THEN 'DELETE_NO_TARGET'
        WHEN action = 'PROGRAM_CREATED' THEN 'MIGRATE_PROGRAM'
        ELSE 'UNROUTED' END
      WHEN 'REPOSITORY' THEN CASE
        WHEN NOT repository_live THEN 'DELETE_REPO_GONE'
        WHEN repository_team_id IS NULL THEN 'DELETE_REPO_NO_TEAM'
        WHEN action = 'REPOSITORY_PUBLISHED' THEN 'MIGRATE_REPOSITORY'
        ELSE 'UNROUTED' END
      WHEN 'USER' THEN CASE
        WHEN imported THEN 'IMPORTED_USER_DOMAIN'
        WHEN user_live THEN 'ABORT_USER_NOT_IMPORTED'
        ELSE 'DELETE_NO_TARGET' END
      WHEN 'ROLE_REQUEST' THEN CASE
        WHEN imported THEN 'IMPORTED_USER_DOMAIN'
        ELSE 'ABORT_USER_NOT_IMPORTED' END
      WHEN 'COLLECTION_SYNC' THEN 'DELETE_COLLECTION_SYNC'
      WHEN 'SUBMISSION_FILE' THEN 'DELETE_SUBMISSION_FILE'
      ELSE 'UNROUTED' END AS route,
    CASE action
      WHEN 'TEAM_CREATED' THEN 'CREATED'
      WHEN 'TEAM_JOINED' THEN 'JOINED'
      WHEN 'TEAM_RENAMED' THEN 'RENAMED'
      WHEN 'TEAM_DELETED' THEN 'DELETED'
      WHEN 'REPOSITORY_PUBLISHED' THEN 'REPOSITORY_PUBLISHED'
      WHEN 'TEAM_MEMBERSHIP_CHANGED' THEN CASE metadata->>'operation'
        WHEN 'LEAVE' THEN 'MEMBER_LEFT'
        WHEN 'REMOVE' THEN 'MEMBER_REMOVED'
        WHEN 'TRANSFER_LEADER' THEN 'LEADER_TRANSFERRED' END
      WHEN 'PROGRAM_CREATED' THEN 'CREATED'
      WHEN 'PROGRAM_DELETED' THEN 'DELETED' END AS event,
    CASE WHEN "targetType" = 'REPOSITORY' THEN repository_team_id ELSE "targetId" END AS team_id,
    COALESCE(repository_program_id, team_program_id, named_program_id) AS program_id
  FROM facts
)
-- audit-log-route:end
SELECT * FROM routed;

DO $$
DECLARE
  unrouted BIGINT;
  application_not_copied BIGINT;
  user_not_imported BIGINT;
  metadata_not_object BIGINT;
BEGIN
  SELECT
    count(*) FILTER (WHERE route = 'UNROUTED'),
    count(*) FILTER (WHERE route = 'ABORT_APPLICATION_NOT_COPIED'),
    count(*) FILTER (WHERE route = 'ABORT_USER_NOT_IMPORTED'),
    count(*) FILTER (WHERE route LIKE 'MIGRATE%' AND jsonb_typeof(metadata) <> 'object')
  INTO unrouted, application_not_copied, user_not_imported, metadata_not_object
  FROM audit_log_route;
  IF unrouted <> 0 OR application_not_copied <> 0 OR user_not_imported <> 0 OR metadata_not_object <> 0 THEN
    RAISE EXCEPTION 'AuditLog retire blocked: unrouted=% application_not_copied=% user_not_imported=% metadata_not_object=%',
      unrouted, application_not_copied, user_not_imported, metadata_not_object;
  END IF;
END $$;

INSERT INTO "TeamHistory" (
  id, "teamId", "programId", "actorId", event, "occurredAt", source,
  "sourceTable", "sourceId", data
)
SELECT 'team-audit:' || id, team_id, program_id, "actorId", event::"TeamHistoryEvent",
  "occurredAt", 'MIGRATION', 'AuditLog', id,
  jsonb_build_object('schemaVersion', 1, 'action', action, 'targetType', "targetType",
    'targetId', "targetId", 'metadata', metadata)
FROM audit_log_route
WHERE route IN ('MIGRATE_TEAM', 'MIGRATE_TEAM_DELETED_EVENT', 'MIGRATE_REPOSITORY')
ON CONFLICT ("sourceTable", "sourceId") DO NOTHING;

INSERT INTO "ProgramHistory" (
  id, "programId", "actorId", event, "occurredAt", source, "sourceTable", "sourceId", data
)
SELECT 'program-audit:' || id, "targetId", "actorId", event::"ProgramHistoryEvent",
  "occurredAt", 'MIGRATION', 'AuditLog', id,
  jsonb_build_object('schemaVersion', 1, 'action', action, 'targetType', "targetType",
    'targetId', "targetId", 'metadata', metadata)
FROM audit_log_route
WHERE route IN ('MIGRATE_PROGRAM', 'MIGRATE_PROGRAM_DELETED_EVENT')
ON CONFLICT ("sourceTable", "sourceId") DO NOTHING;

DO $$
DECLARE
  team_missing BIGINT;
  program_missing BIGINT;
  routed_rows BIGINT;
  audit_rows BIGINT;
BEGIN
  SELECT count(*) INTO team_missing
  FROM audit_log_route r
  WHERE r.route IN ('MIGRATE_TEAM', 'MIGRATE_TEAM_DELETED_EVENT', 'MIGRATE_REPOSITORY')
    AND NOT EXISTS (
      SELECT 1 FROM "TeamHistory" h
      WHERE h."sourceTable" = 'AuditLog' AND h."sourceId" = r.id
        AND h.event::TEXT = r.event AND h."teamId" = r.team_id AND h."programId" = r.program_id
        AND h."actorId" = r."actorId" AND h."occurredAt" = r."occurredAt"
        AND h.data->'metadata' = r.metadata
    );
  SELECT count(*) INTO program_missing
  FROM audit_log_route r
  WHERE r.route IN ('MIGRATE_PROGRAM', 'MIGRATE_PROGRAM_DELETED_EVENT')
    AND NOT EXISTS (
      SELECT 1 FROM "ProgramHistory" h
      WHERE h."sourceTable" = 'AuditLog' AND h."sourceId" = r.id
        AND h.event::TEXT = r.event AND h."programId" = r."targetId"
        AND h."actorId" = r."actorId" AND h."occurredAt" = r."occurredAt"
        AND h.data->'metadata' = r.metadata
    );
  SELECT count(*) INTO routed_rows FROM audit_log_route;
  SELECT count(*) INTO audit_rows FROM "AuditLog";
  IF team_missing <> 0 OR program_missing <> 0 OR routed_rows <> audit_rows THEN
    RAISE EXCEPTION 'AuditLog retire reconciliation failed: team_missing=% program_missing=% routed=% audit=%',
      team_missing, program_missing, routed_rows, audit_rows;
  END IF;
END $$;

DROP TABLE "AuditLog";

COMMIT;
