BEGIN READ ONLY;

SELECT jsonb_build_object(
  'invitationRows', (SELECT count(*) FROM "TeamInvitation"),
  'pendingRows', (SELECT count(*) FROM "TeamInvitation" WHERE status = 'PENDING'),
  'terminalRows', (SELECT count(*) FROM "TeamInvitation" WHERE status <> 'PENDING'),
  'responseValues', (SELECT count(*) FROM "TeamInvitation" WHERE "respondedAt" IS NOT NULL),
  'preparationRows', (SELECT count(*) FROM "ApplicationPreparation"),
  'participantRows', (SELECT count(*) FROM "ApplicationPreparationParticipant"),
  'historyRows', (SELECT count(*) FROM "TeamHistory"),
  'duplicateInvitationGroups', (
    SELECT count(*) FROM (
      SELECT "teamId", "inviteeId" FROM "TeamInvitation"
      GROUP BY "teamId", "inviteeId" HAVING count(*) > 1
    ) duplicates
  ),
  'validatedPendingConstraint', EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"TeamInvitation"'::regclass
      AND conname = 'TeamInvitation_pending_only' AND convalidated
  ),
  'preparationColumns', (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('ApplicationPreparation', 'ApplicationPreparationParticipant')
  ),
  'preparationIndexes', (
    SELECT count(*) FROM pg_indexes WHERE schemaname = 'public'
      AND tablename IN ('ApplicationPreparation', 'ApplicationPreparationParticipant')
  ),
  'preparationConstraints', (
    SELECT count(*) FROM pg_constraint
    WHERE conrelid IN ('"ApplicationPreparation"'::regclass, '"ApplicationPreparationParticipant"'::regclass)
  ),
  'enumLabels', (
    SELECT count(*) FROM pg_enum WHERE enumtypid = '"TeamInvitationStatus"'::regtype
  ),
  'migrationHead', (SELECT migration_name FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1)
);

COMMIT;
