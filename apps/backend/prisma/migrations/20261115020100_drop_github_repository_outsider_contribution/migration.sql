BEGIN;
SET LOCAL lock_timeout = '5s';

DROP TABLE "GithubRepositoryOutsiderContribution";

COMMIT;
