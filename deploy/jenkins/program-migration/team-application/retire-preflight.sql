WITH checks AS (
  SELECT (SELECT count(*) FROM "Application") <> 33 AS mismatch
  UNION ALL SELECT (SELECT count(*) FROM "ApplicationReviewHistory") <> 9
  UNION ALL SELECT (SELECT count(*) FROM program_team_backup.application_team_map) <> 33
  UNION ALL SELECT (SELECT count(*) FROM "TeamHistory" WHERE id LIKE 'application-review:%') <> 9
  UNION ALL SELECT (SELECT count(*) FROM "TeamHistory" WHERE id LIKE 'application-audit:%') <> 64
  UNION ALL SELECT (SELECT count(DISTINCT data->>'pairedAuditId') FROM "TeamHistory" WHERE data ? 'pairedAuditId') <> 9
  UNION ALL SELECT EXISTS (
    SELECT 1 FROM "Application" a
    LEFT JOIN program_team_backup.application_team_map m ON m."applicationId" = a.id
    LEFT JOIN "Team" t ON t.id = m."teamId"
    WHERE t.id IS NULL
  )
)
SELECT count(*) FROM checks WHERE mismatch;
