
ALTER TABLE "GithubRepository"
  ADD COLUMN "applicationId" TEXT,
  ADD COLUMN "programId" TEXT,
  ADD COLUMN "teamId" TEXT,
  ADD COLUMN "publishedAt" TIMESTAMP(3);

DO $$
DECLARE
  bad_id TEXT;
  bad_url TEXT;
BEGIN
  SELECT r."id", r."url" INTO bad_id, bad_url
  FROM "Repository" r
  WHERE NOT EXISTS (
    SELECT 1 FROM "GithubRepository" g WHERE g."githubRepositoryId" = r."githubRepositoryId"
  )
  AND regexp_replace(
        regexp_replace(r."url", '^https?://(www\.)?github\.com/', '', 'i'),
        '/+$', ''
      ) !~ '^[^/]+/[^/]+$'
  LIMIT 1;

  IF bad_id IS NOT NULL THEN
    RAISE EXCEPTION 'unify-repository-into-github-repository 마이그레이션 중단: Repository.id=% 의 url=% 이 정규화 후에도 canonical owner/name 형태가 아니다', bad_id, bad_url;
  END IF;
END $$;

INSERT INTO "GithubRepository" (
  "id",
  "githubOrganizationId",
  "githubRepositoryId",
  "nameWithOwner",
  "defaultBranch",
  "archived",
  "source",
  "visibility",
  "presence",
  "lastCompleteInventoryObservedAt",
  "nextRunAt",
  "lastSuccessAt",
  "failureCount",
  "applicationId",
  "programId",
  "teamId",
  "publishedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  r."id",
  NULL,
  r."githubRepositoryId",
  regexp_replace(
    regexp_replace(r."url", '^https?://(www\.)?github\.com/', '', 'i'),
    '/+$', ''
  ),
  NULL,
  false,
  'ORG_PROVISIONED',
  r."visibility",
  'PRESENT',
  NULL,
  now(),
  NULL,
  0,
  r."applicationId",
  r."programId",
  r."teamId",
  r."publishedAt",
  r."createdAt",
  r."updatedAt"
FROM "Repository" r
WHERE NOT EXISTS (
  SELECT 1 FROM "GithubRepository" g WHERE g."githubRepositoryId" = r."githubRepositoryId"
);

UPDATE "GithubRepository" g
SET
  "id" = r."id",
  "applicationId" = r."applicationId",
  "programId" = r."programId",
  "teamId" = r."teamId",
  "publishedAt" = r."publishedAt",
  "visibility" = r."visibility"
FROM "Repository" r
WHERE g."githubRepositoryId" = r."githubRepositoryId";

ALTER TABLE "RepositoryInvitation" DROP CONSTRAINT "RepositoryInvitation_repositoryId_fkey";
ALTER TABLE "RepositoryInvitation"
  ADD CONSTRAINT "RepositoryInvitation_repositoryId_fkey"
  FOREIGN KEY ("repositoryId") REFERENCES "GithubRepository"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RepositoryProvisionJob" DROP CONSTRAINT "RepositoryProvisionJob_repositoryId_fkey";
ALTER TABLE "RepositoryProvisionJob"
  ADD CONSTRAINT "RepositoryProvisionJob_repositoryId_fkey"
  FOREIGN KEY ("repositoryId") REFERENCES "GithubRepository"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

DROP TABLE "Repository";

ALTER TABLE "GithubRepository"
  ADD CONSTRAINT "GithubRepository_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "Application"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GithubRepository"
  ADD CONSTRAINT "GithubRepository_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "Program"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GithubRepository"
  ADD CONSTRAINT "GithubRepository_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "GithubRepository_applicationId_key" ON "GithubRepository"("applicationId");
CREATE INDEX "GithubRepository_programId_idx" ON "GithubRepository"("programId");
CREATE INDEX "GithubRepository_teamId_idx" ON "GithubRepository"("teamId");
CREATE INDEX "GithubRepository_visibility_publishedAt_id_idx" ON "GithubRepository"("visibility", "publishedAt", "id");
