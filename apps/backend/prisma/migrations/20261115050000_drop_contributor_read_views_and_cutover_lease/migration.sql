BEGIN;
SET LOCAL lock_timeout = '5s';

DROP VIEW contributor_standing;
DROP VIEW repo_contribution;
DROP TABLE "CollectionCutoverLease";

COMMIT;
