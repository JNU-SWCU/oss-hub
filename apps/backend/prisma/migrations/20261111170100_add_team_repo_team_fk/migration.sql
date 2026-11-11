-- One statement. SHARE ROW EXCLUSIVE on "Team" ends when this statement ends.
-- PostgreSQL enforces lock_timeout. Nothing in the app counts these seconds.
-- The raised message is what Prisma prints. A later COMMIT would hide 55P03.
DO $body$
BEGIN
  PERFORM set_config('lock_timeout', '2s', true);
  EXECUTE
    'ALTER TABLE "team_repo" ADD CONSTRAINT "team_repo_team_id_fkey" '
    'FOREIGN KEY ("team_id") REFERENCES "Team"("id") '
    'ON DELETE RESTRICT ON UPDATE CASCADE';
EXCEPTION
  WHEN lock_not_available THEN
    RAISE EXCEPTION 'OSS_HUB_LOCK_TIMEOUT 55P03';
END
$body$;
