-- Deployment pauses admission and stops the old processes before switching.
-- Installing the migration alone must not start either generation of sender.
ALTER TABLE "MailControl" DROP CONSTRAINT "MailControl_mode_check";
ALTER TABLE "MailControl" ADD COLUMN "senderHost" text CHECK ("senderHost" ~ '^[a-f0-9]{64}$');

CREATE FUNCTION guard_mail_mode_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.mode = NEW.mode THEN RETURN NEW; END IF;
  IF OLD.mode <> 'PAUSED' AND NEW.mode <> 'PAUSED' THEN
    RAISE EXCEPTION 'pause mail before changing senders' USING ERRCODE = '55000';
  END IF;
  IF NEW.mode = 'LEGACY' AND EXISTS (
    SELECT FROM "MailJob" WHERE "partNo" = 0 AND "legacySnapshotStatus" IS NULL
  ) THEN
    RAISE EXCEPTION 'typed receipts require read-only rollback' USING ERRCODE = '55000';
  END IF;
  IF NEW.mode = 'JOBS' AND EXISTS (
    SELECT FROM "Notification" n WHERE n.type IN ('PROGRAM_MAIL_SEND', 'PROGRAM_MAIL')
      AND (n.status IN ('PENDING', 'PROCESSING') OR
        (n.type = 'PROGRAM_MAIL_SEND' AND NOT EXISTS (
          SELECT FROM "MailJob" j WHERE j.id = n.id
            AND j."legacySnapshotStatus" = 'COMPLETED'
        )))
  ) THEN
    RAISE EXCEPTION 'legacy mail requires reconciliation' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER mail_mode_transition BEFORE UPDATE OF mode ON "MailControl"
FOR EACH ROW EXECUTE FUNCTION guard_mail_mode_change();

-- Historical snapshots are refreshed only by the paused importer. Native
-- recipient state is monotone, including when a future worker is rolled back.
CREATE FUNCTION guard_native_mail_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state = OLD.state THEN RETURN NEW; END IF;
  IF EXISTS (SELECT FROM "MailJob" WHERE id = OLD."jobId" AND "legacySnapshotStatus" IS NOT NULL) THEN
    RAISE EXCEPTION 'imported mail is not sendable' USING ERRCODE = '55000';
  END IF;
  IF OLD.state = 'PENDING' AND NEW.state IN ('SENDING', 'CANCELLED') THEN
    PERFORM 1 FROM "MailControl" WHERE id = 1 AND mode = 'JOBS' FOR SHARE;
    IF FOUND THEN RETURN NEW; END IF;
  ELSIF OLD.state = 'SENDING' AND NEW.state IN ('SENT', 'FAILED', 'UNKNOWN') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'invalid mail recipient transition' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER mail_recipient_transition BEFORE UPDATE OF state ON "MailRecipient"
FOR EACH ROW EXECUTE FUNCTION guard_native_mail_transition();
