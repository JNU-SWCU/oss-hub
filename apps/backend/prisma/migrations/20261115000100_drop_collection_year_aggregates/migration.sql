BEGIN;
SET LOCAL lock_timeout = '5s';

DROP TABLE "CollectionRepositoryYearAggregate";
DROP TABLE "CollectionContributorYearAggregate";

COMMIT;
