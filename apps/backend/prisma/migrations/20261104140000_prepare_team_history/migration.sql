BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ApplicationPreparation")
     OR EXISTS (SELECT 1 FROM "ApplicationPreparationParticipant") THEN
    RAISE EXCEPTION 'Preparation must be empty before retiring its runtime';
  END IF;
END $$;

CREATE TYPE "TeamHistoryEvent" AS ENUM (
  'INVITATION_ACCEPTED',
  'INVITATION_DECLINED',
  'INVITATION_CANCELLED'
);

-- Identifiers are snapshots: deleting a team must not delete its history.
CREATE TABLE "TeamHistory" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "teamId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "actorId" TEXT,
  "event" "TeamHistoryEvent" NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source" "HistorySource" NOT NULL,
  "sourceTable" TEXT,
  "sourceId" TEXT,
  "data" JSONB NOT NULL,
  CONSTRAINT "TeamHistory_invitation_data_check" CHECK (
    ("data"->>'schemaVersion' = '1'
      AND jsonb_typeof("data"->'invitation') = 'object'
      AND jsonb_typeof("data"->'invitation'->'id') = 'string'
      AND jsonb_typeof("data"->'invitation'->'inviteeId') = 'string'
      AND jsonb_typeof("data"->'invitation'->'invitedById') = 'string'
      AND jsonb_typeof("data"->'invitation'->'createdAt') = 'string') IS TRUE
  )
);

CREATE UNIQUE INDEX "TeamHistory_sourceTable_sourceId_key"
  ON "TeamHistory"("sourceTable", "sourceId");
CREATE INDEX "TeamHistory_teamId_occurredAt_id_idx"
  ON "TeamHistory"("teamId", "occurredAt", "id");
CREATE INDEX "TeamHistory_programId_occurredAt_id_idx"
  ON "TeamHistory"("programId", "occurredAt", "id");
CREATE INDEX "TeamHistory_actorId_occurredAt_id_idx"
  ON "TeamHistory"("actorId", "occurredAt", "id");

-- Legacy terminal invitations, status, and Preparation tables remain intact.
COMMIT;
