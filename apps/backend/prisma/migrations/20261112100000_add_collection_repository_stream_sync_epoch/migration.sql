-- Nullable BIGINT with no default. PostgreSQL keeps this ADD COLUMN in the
-- catalog, so ACCESS EXCLUSIVE lasts for the catalog update, not a rewrite.
-- lock_timeout stops a busy table from holding that lock past two seconds.
DO $body$
BEGIN
  PERFORM set_config('lock_timeout', '2s', true);
  EXECUTE 'ALTER TABLE "CollectionRepositoryStream" ADD COLUMN "sync_epoch" BIGINT';
EXCEPTION
  WHEN lock_not_available THEN
    RAISE EXCEPTION 'OSS_HUB_LOCK_TIMEOUT 55P03';
END
$body$;
