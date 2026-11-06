BEGIN;
SET LOCAL lock_timeout = '5s';

-- The application reads the repository address from GithubRepository.nameWithOwner only,
-- so Team.repositoryUrl has no reader or writer left.
-- Lock first so no write lands between the count and the drop. The guard raises before
-- any change unless the column holds exactly the 3 production values, or none on a fresh database.
LOCK TABLE "Team" IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  repository_url_count bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'Team' AND column_name = 'repositoryUrl'
  ) THEN
    RAISE EXCEPTION 'Team.repositoryUrl drop blocked: column is missing';
  END IF;
  SELECT count(*) INTO repository_url_count FROM "Team" WHERE "repositoryUrl" IS NOT NULL;
  IF repository_url_count NOT IN (0, 3) THEN
    RAISE EXCEPTION 'Team.repositoryUrl drop blocked: non-null=%, expected 3', repository_url_count;
  END IF;
END $$;

ALTER TABLE "Team" DROP COLUMN "repositoryUrl";

COMMIT;
