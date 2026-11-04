SELECT
  (SELECT count(*) FROM "ApplicationPreparation") +
  (SELECT count(*) FROM "ApplicationPreparationParticipant") +
  (SELECT count(*) FROM "TeamHistory"
   WHERE "sourceTable" = 'TeamInvitation'
     AND ("data"->'invitation'->>'id' IS DISTINCT FROM "sourceId"
          OR "data"->>'schemaVersion' IS DISTINCT FROM '1'));
