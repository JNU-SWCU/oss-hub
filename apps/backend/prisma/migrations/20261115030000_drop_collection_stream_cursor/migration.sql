BEGIN;
SET LOCAL lock_timeout = '5s';

DROP TABLE "CollectionRepositoryStream";
DROP TABLE "CollectionSyncCursor";
DROP TYPE "CollectionStreamStatus";
DROP TYPE "CollectionStreamType";

COMMIT;
