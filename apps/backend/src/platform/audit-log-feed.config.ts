export const AUDIT_LOG_FEED_CTE = `
    WITH histories AS (
      SELECT "id", "userId", "actorId", "event"::text, "occurredAt",
        "sourceTable", "sourceId", "sourcePart", "data"
      FROM "UserHistory"
      UNION ALL
      SELECT "id", "userId", "actorId", "event"::text, "occurredAt",
        "sourceTable", "sourceId", "sourcePart", "data"
      FROM "AdminHistory"
    ), imported AS (
      SELECT DISTINCT ON ("sourceId") "sourceId" AS "id", "actorId",
        "occurredAt", "data"->'original' AS "original"
      FROM histories
      WHERE "event" = 'LEGACY_IMPORT' AND "sourceTable" = 'AuditLog'
        AND "sourceId" IS NOT NULL
        AND "data"->>'schemaVersion' = '1'
        AND "data"->>'recordKind' = 'AUDIT_EVENT'
      ORDER BY "sourceId", "sourcePart", "id"
    ), events AS (
      SELECT "id", "actorId", "occurredAt",
        "original"->>'action' AS "action",
        "original"->>'targetType' AS "targetType",
        "original"->>'targetId' AS "targetId",
        "original"->'metadata' AS "metadata", true AS "legacySource",
        NULL::text AS "historyKind"
      FROM imported
      UNION ALL
      SELECT "id", "actorId", "occurredAt",
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
        false,
        CASE WHEN "data"->>'recordKind' = 'DOMAIN_EVENT' THEN NULL
          ELSE "data"->>'recordKind' END
      FROM histories
      WHERE "event" <> 'LEGACY_IMPORT'
        AND "data"->>'schemaVersion' = '1'
        AND "data"->>'recordKind' IN ('DOMAIN_EVENT', 'REQUEST_TRANSITION', 'SIGNUP', 'BOOTSTRAP', 'TYPE_SELECTION')
      UNION ALL
      SELECT audit."id", audit."actorId", audit."occurredAt", audit."action",
        audit."targetType", audit."targetId", audit."metadata",
        audit."targetType" IN ('USER', 'ROLE_REQUEST'), NULL::text
      FROM "AuditLog" audit
      WHERE NOT EXISTS (SELECT 1 FROM imported WHERE imported."id" = audit."id")
    )
`;
