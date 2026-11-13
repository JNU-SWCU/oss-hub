BEGIN;
SET LOCAL lock_timeout = '5s';

DROP TABLE "CollectionSweepHistory";
DROP TYPE "CollectionRunKind";

COMMIT;
