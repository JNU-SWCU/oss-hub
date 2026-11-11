-- One statement. ACCESS EXCLUSIVE on "Team" ends when this statement ends.
-- PostgreSQL enforces lock_timeout. Nothing in the app counts these seconds.
-- The raised message is what Prisma prints. A later COMMIT would hide 55P03.
DO $body$
BEGIN
  PERFORM set_config('lock_timeout', '2s', true);
  EXECUTE 'ALTER TABLE "Team" ADD COLUMN "archivedAt" TIMESTAMP(3)';
EXCEPTION
  WHEN lock_not_available THEN
    RAISE EXCEPTION 'OSS_HUB_LOCK_TIMEOUT 55P03';
END
$body$;
