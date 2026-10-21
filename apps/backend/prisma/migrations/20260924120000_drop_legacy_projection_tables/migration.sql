BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

LOCK TABLE
  "PublicShowcaseRepository",
  "PublicShowcaseContributor",
  "CollectionRun",
  "GithubRawObservation"
IN ACCESS EXCLUSIVE MODE;

DO $preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM "PublicShowcaseRepository")
    OR EXISTS (SELECT 1 FROM "PublicShowcaseContributor")
    OR EXISTS (SELECT 1 FROM "CollectionRun")
    OR EXISTS (SELECT 1 FROM "GithubRawObservation")
  THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = 'legacy tables require reconciliation';
  END IF;
END
$preflight$;

DROP TABLE "PublicShowcaseContributor";
DROP TABLE "PublicShowcaseRepository";
DROP TABLE "GithubRawObservation";
DROP TABLE "CollectionRun";

DROP TYPE "ObservationSourceType";
DROP TYPE "CollectionRunStatus";
DROP TYPE "CollectionTrigger";

COMMIT;
