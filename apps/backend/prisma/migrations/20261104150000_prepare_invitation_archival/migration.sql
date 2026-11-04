BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ApplicationPreparation")
     OR EXISTS (SELECT 1 FROM "ApplicationPreparationParticipant") THEN
    RAISE EXCEPTION 'Preparation must be empty before removing its readers';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"ApplicationPreparation"'::regclass
      AND conname = 'ApplicationPreparation_retired'
  ) THEN
    ALTER TABLE "ApplicationPreparation"
      ADD CONSTRAINT "ApplicationPreparation_retired" CHECK (false);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"ApplicationPreparationParticipant"'::regclass
      AND conname = 'ApplicationPreparationParticipant_retired'
  ) THEN
    ALTER TABLE "ApplicationPreparationParticipant"
      ADD CONSTRAINT "ApplicationPreparationParticipant_retired" CHECK (false);
  END IF;
END $$;
ALTER TYPE "TeamHistoryEvent" ADD VALUE IF NOT EXISTS 'INVITATION_ARCHIVED';
COMMIT;
