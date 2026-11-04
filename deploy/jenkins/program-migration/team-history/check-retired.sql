SELECT
  (SELECT count(*) FROM "TeamInvitation" WHERE status <> 'PENDING' OR "respondedAt" IS NOT NULL)
  + (SELECT count(*) FROM "ApplicationPreparation")
  + (SELECT count(*) FROM "ApplicationPreparationParticipant")
  + (SELECT count(*) FROM "TeamHistory" WHERE "sourceTable" = 'TeamInvitation'
      AND (data->'invitation'->>'id' IS DISTINCT FROM "sourceId"))
  + CASE WHEN EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = '"TeamInvitation"'::regclass
        AND conname = 'TeamInvitation_pending_only' AND convalidated
    ) THEN 0 ELSE 1 END;
