CREATE TYPE "MailMode" AS ENUM ('LEGACY', 'PAUSED', 'JOBS');
CREATE TYPE "MailSource" AS ENUM ('PROGRAM_MANUAL', 'DEADLINE_MANUAL', 'DEADLINE_AUTOMATIC');
CREATE TYPE "MailPartState" AS ENUM ('QUEUED', 'IN_PROGRESS', 'COMPLETED', 'QUARANTINED');
CREATE TYPE "MailAudience" AS ENUM ('STUDENT', 'STAFF');
CREATE TYPE "MailRecipientState" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'UNKNOWN', 'ALREADY_RESERVED', 'CANCELLED');
ALTER TYPE "ProgramHistoryEvent" ADD VALUE 'MAIL_ACCEPTED';
ALTER TYPE "ProgramHistoryEvent" ADD VALUE 'MAIL_COMPLETED';

CREATE TABLE "MailControl" (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  mode "MailMode" NOT NULL CHECK (mode IN ('LEGACY', 'PAUSED'))
);
INSERT INTO "MailControl" (id, mode) VALUES (1, 'LEGACY');

CREATE TABLE "MailJob" (
  id TEXT PRIMARY KEY,
  "receiptId" TEXT NOT NULL,
  "partNo" INTEGER NOT NULL CHECK ("partNo" >= 0),
  source "MailSource" NOT NULL,
  "programId" TEXT NOT NULL REFERENCES "Program"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "actorId" TEXT REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "intentKey" TEXT UNIQUE,
  "requestDigest" TEXT,
  "previewVersion" TEXT,
  "seoulDay" DATE NOT NULL,
  state "MailPartState" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "partFinishedAt" TIMESTAMP(3),
  "receiptFinishedAt" TIMESTAMP(3),
  result JSONB,
  UNIQUE ("receiptId", "partNo"),
  CHECK (("partNo" = 0 AND id = "receiptId") OR ("partNo" > 0 AND id <> "receiptId" AND "intentKey" IS NULL AND result IS NULL AND "receiptFinishedAt" IS NULL)),
  CHECK (source = 'DEADLINE_AUTOMATIC' OR "actorId" IS NOT NULL),
  CHECK (("receiptFinishedAt" IS NULL) = (result IS NULL))
);
CREATE INDEX "MailJob_state_createdAt_id_idx" ON "MailJob"(state, "createdAt", id);
CREATE INDEX "MailJob_programId_createdAt_id_idx" ON "MailJob"("programId", "createdAt", id);
CREATE INDEX "MailJob_actorId_createdAt_idx" ON "MailJob"("actorId", "createdAt");
CREATE INDEX "MailJob_receiptId_state_idx" ON "MailJob"("receiptId", state);
ALTER TABLE "MailJob" ADD CONSTRAINT "MailJob_receiptId_fkey"
  FOREIGN KEY ("receiptId") REFERENCES "MailJob"(id) ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "ProgramHistory" ADD CONSTRAINT "ProgramHistory_mail_action_check"
  CHECK (
    event::text NOT IN ('MAIL_ACCEPTED', 'MAIL_COMPLETED')
    OR (
      "sourceTable" = 'MailJob' AND "sourceId" IS NOT NULL AND
      data->>'action' IN (
        'PROGRAM_MAIL_SEND_ATTEMPTED', 'PROGRAM_MAIL_SENT',
        'PROGRAM_MAIL_FAILED', 'PROGRAM_MAIL_PARTIALLY_FAILED', 'PROGRAM_MAIL_DELIVERY_UNKNOWN'
      )
    ) IS TRUE
  );

CREATE TABLE "MailRecipient" (
  id TEXT PRIMARY KEY,
  "jobId" TEXT NOT NULL REFERENCES "MailJob"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 199),
  audience "MailAudience" NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "deliveryKey" TEXT UNIQUE,
  "priorReceiptId" TEXT,
  state "MailRecipientState" NOT NULL,
  reason TEXT,
  envelope JSONB,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  UNIQUE ("jobId", ordinal),
  CHECK (state IN ('PENDING', 'SENDING') OR envelope IS NULL)
);

CREATE FUNCTION guard_legacy_mail_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_mode "MailMode";
BEGIN
  IF NEW.type NOT IN ('PROGRAM_MAIL_SEND', 'PROGRAM_MAIL', 'DEADLINE_DIGEST') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status NOT IN ('PENDING', 'PROCESSING') THEN RETURN NEW; END IF;
    IF NEW.status = OLD.status AND NEW.payload->>'leaseToken' IS NOT DISTINCT FROM OLD.payload->>'leaseToken' THEN
      RETURN NEW;
    END IF;
  END IF;
  SELECT mode INTO current_mode FROM "MailControl" WHERE id = 1 FOR SHARE;
  IF current_mode IS DISTINCT FROM 'LEGACY'::"MailMode" THEN
    RAISE EXCEPTION 'mail admissions paused' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER legacy_mail_mode BEFORE INSERT OR UPDATE ON "Notification"
FOR EACH ROW EXECUTE FUNCTION guard_legacy_mail_write();

CREATE FUNCTION import_legacy_program_mail(receipt TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  batch "Notification"%ROWTYPE;
  total INTEGER;
  sent INTEGER;
  failed INTEGER;
  unknown_count INTEGER;
  stored JSONB;
  current_mode "MailMode";
BEGIN
  SELECT mode INTO current_mode FROM "MailControl" WHERE id = 1 FOR SHARE;
  IF current_mode IS DISTINCT FROM 'PAUSED'::"MailMode" THEN
    RAISE EXCEPTION 'mail bridge import requires paused admissions' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO STRICT batch FROM "Notification"
    WHERE id = receipt AND type = 'PROGRAM_MAIL_SEND' AND channel = 'INTERNAL' FOR UPDATE;
  IF EXISTS (SELECT 1 FROM "MailJob" WHERE id = receipt) THEN RETURN receipt; END IF;
  IF batch.payload->>'schemaVersion' IS DISTINCT FROM '1' OR batch."idempotencyKey" IS NULL THEN
    RAISE EXCEPTION 'unrecognized mail provenance' USING ERRCODE = '22023';
  END IF;
  SELECT count(*)::int,
    count(*) FILTER (WHERE status = 'SENT')::int,
    count(*) FILTER (WHERE status = 'FAILED' AND payload->>'code' IS DISTINCT FROM 'MAIL_DELIVERY_UNKNOWN')::int,
    count(*) FILTER (WHERE status = 'FAILED' AND payload->>'code' = 'MAIL_DELIVERY_UNKNOWN')::int
  INTO total, sent, failed, unknown_count
  FROM "Notification"
  WHERE type = 'PROGRAM_MAIL' AND channel = 'EMAIL' AND payload->>'batchKey' = batch."idempotencyKey";
  IF total > 200 THEN RAISE EXCEPTION 'legacy batch exceeds recipient cap' USING ERRCODE = '22023'; END IF;
  stored := batch.payload->'result';
  IF batch.status = 'COMPLETED' AND (
    batch."sentAt" IS NULL OR stored IS NULL OR
    (stored->>'sentCount')::int IS DISTINCT FROM sent OR
    (stored->>'failedCount')::int IS DISTINCT FROM failed OR
    coalesce((stored->>'unknownCount')::int, 0) <> unknown_count OR
    (stored->>'duplicateCount')::int IS DISTINCT FROM 0 OR
    total <> sent + failed + unknown_count
  ) THEN RAISE EXCEPTION 'legacy terminal receipt does not reconcile' USING ERRCODE = '22023'; END IF;
  INSERT INTO "MailJob" (
    id, "receiptId", "partNo", source, "programId", "actorId", "intentKey",
    "previewVersion", "seoulDay", state, "createdAt", "updatedAt",
    "partFinishedAt", "receiptFinishedAt", result
  ) VALUES (
    receipt, receipt, 0, 'PROGRAM_MANUAL', batch.payload->>'programId', batch."userId", batch."idempotencyKey",
    batch.payload->>'previewVersion', (batch."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date,
    CASE WHEN batch.status = 'COMPLETED' THEN 'COMPLETED'::"MailPartState" ELSE 'QUARANTINED'::"MailPartState" END,
    batch."createdAt", CURRENT_TIMESTAMP,
    CASE WHEN batch.status = 'COMPLETED' THEN batch."sentAt" END,
    CASE WHEN batch.status = 'COMPLETED' THEN batch."sentAt" END,
    CASE WHEN batch.status = 'COMPLETED' THEN stored END
  );
  INSERT INTO "MailRecipient" (id, "jobId", ordinal, audience, "userId", "deliveryKey", state, reason, "updatedAt", "finishedAt")
  SELECT id, receipt, (row_number() OVER (ORDER BY id) - 1)::int, 'STUDENT', "userId", "idempotencyKey",
    CASE
      WHEN status = 'SENT' THEN 'SENT'::"MailRecipientState"
      WHEN status = 'FAILED' AND payload->>'code' = 'MAIL_DELIVERY_UNKNOWN' THEN 'UNKNOWN'::"MailRecipientState"
      WHEN status = 'FAILED' THEN 'FAILED'::"MailRecipientState"
      WHEN status = 'PROCESSING' THEN 'SENDING'::"MailRecipientState"
      ELSE 'PENDING'::"MailRecipientState"
    END,
    CASE WHEN status = 'FAILED' THEN payload->>'code' END, CURRENT_TIMESTAMP, "sentAt"
  FROM "Notification"
  WHERE type = 'PROGRAM_MAIL' AND channel = 'EMAIL' AND payload->>'batchKey' = batch."idempotencyKey";
  RETURN receipt;
END;
$$;
