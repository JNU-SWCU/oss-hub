BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$
BEGIN
  IF to_regclass('public."UserPolicy"') IS NULL THEN
    RAISE EXCEPTION 'user consolidation: cannot commit OPEN on old schema';
  END IF;
  UPDATE user_consolidation_backup.control SET phase='OPEN_COMMITTED'
    WHERE phase IN ('FENCED','OPEN_COMMITTED');
  IF NOT FOUND THEN RAISE EXCEPTION 'user consolidation: invalid OPEN decision'; END IF;
END $$;
COMMIT;
