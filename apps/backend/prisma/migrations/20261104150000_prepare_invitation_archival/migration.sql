BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ApplicationPreparation")
     OR EXISTS (SELECT 1 FROM "ApplicationPreparationParticipant") THEN
    RAISE EXCEPTION 'Preparation must be empty before removing its readers';
  END IF;
END $$;
ALTER TYPE "TeamHistoryEvent" ADD VALUE IF NOT EXISTS 'INVITATION_ARCHIVED';
COMMIT;
