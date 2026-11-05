WITH pairs AS (
  SELECT h.id AS review_id, l.id AS audit_id
  FROM "ApplicationReviewHistory" h
  JOIN "Application" a ON a.id = h."applicationId"
  JOIN "AuditLog" l ON l."targetType" = 'APPLICATION'
    AND l."targetId" = a.id AND l."actorId" = h."actorId"
    AND l.action = 'APPLICATION_' || h."eventKind"::text
    AND abs(extract(epoch FROM l."occurredAt" - h."occurredAt")) <= 1
), checks AS (
  SELECT (SELECT count(*) FROM "Team") <> 40 AS mismatch
  UNION ALL SELECT (SELECT count(*) FROM "Application") <> 33
  UNION ALL SELECT (SELECT count(*) FROM "TeamMember") <> 72
  UNION ALL SELECT (SELECT count(*) FROM "TeamInvitation") <> 3
  UNION ALL SELECT (SELECT count(*) FROM "ApplicationReviewHistory") <> 9
  UNION ALL SELECT (SELECT count(*) FROM pairs) <> 9
  UNION ALL SELECT EXISTS (SELECT review_id FROM pairs GROUP BY review_id HAVING count(*) <> 1)
  UNION ALL SELECT EXISTS (SELECT audit_id FROM pairs GROUP BY audit_id HAVING count(*) <> 1)
  UNION ALL SELECT (SELECT count(*) FROM "AuditLog" l JOIN "Application" a ON a.id = l."targetId"
    WHERE l."targetType" = 'APPLICATION') <> 73
  UNION ALL SELECT (SELECT count(*) FROM "Team" t
    WHERE NOT EXISTS (SELECT 1 FROM "Application" a WHERE a."teamId" = t.id)) <> 7
)
SELECT count(*) FROM checks WHERE mismatch;
