BEGIN;

LOCK TABLE "TeamInvitation", "ApplicationPreparation", "ApplicationPreparationParticipant" IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  invitation_count BIGINT;
  terminal_count BIGINT;
  response_count BIGINT;
  preparation_count BIGINT;
  participant_count BIGINT;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE status <> 'PENDING'),
         count(*) FILTER (WHERE "respondedAt" IS NOT NULL)
    INTO invitation_count, terminal_count, response_count
    FROM "TeamInvitation";
  SELECT count(*) INTO preparation_count FROM "ApplicationPreparation";
  SELECT count(*) INTO participant_count FROM "ApplicationPreparationParticipant";
  RAISE NOTICE 'Invitation schema retirement: invitations=%, terminal=%, responses=%, preparations=%, participants=%',
    invitation_count, terminal_count, response_count, preparation_count, participant_count;
  IF preparation_count <> 0 OR participant_count <> 0 THEN
    RAISE EXCEPTION 'Preparation retirement requires empty tables: preparations=%, participants=%',
      preparation_count, participant_count;
  END IF;
  IF terminal_count <> 0 OR response_count <> 0 THEN
    RAISE EXCEPTION 'Invitation retirement requires pending-only rows without response timestamps: terminal=%, responses=%',
      terminal_count, response_count;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"TeamInvitation"'::regclass
      AND conname = 'TeamInvitation_pending_only' AND convalidated
  ) THEN
    RAISE EXCEPTION 'Invitation retirement requires the validated pending-only constraint';
  END IF;
END $$;

DROP INDEX "TeamInvitation_teamId_inviteeId_pending_key";
DROP INDEX "TeamInvitation_inviteeId_status_idx";
ALTER TABLE "TeamInvitation"
  DROP CONSTRAINT "TeamInvitation_pending_only",
  DROP COLUMN "status",
  DROP COLUMN "respondedAt";
CREATE UNIQUE INDEX "TeamInvitation_teamId_inviteeId_key" ON "TeamInvitation"("teamId", "inviteeId");
CREATE INDEX "TeamInvitation_inviteeId_idx" ON "TeamInvitation"("inviteeId");
DROP TABLE "ApplicationPreparationParticipant";
DROP TABLE "ApplicationPreparation";
DROP TYPE "TeamInvitationStatus";

COMMIT;
