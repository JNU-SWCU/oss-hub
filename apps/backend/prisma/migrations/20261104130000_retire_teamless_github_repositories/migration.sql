BEGIN;

LOCK TABLE "Application", "GithubRepository", "CollectionCommitFact",
  "Contribution", "CollectionRepositoryStream", "CollectionPullRequestFact",
  "CollectionReleaseFact", "GithubIssueHistory",
  "GithubRepositoryOutsiderContribution", "RepositoryInvitation",
  "RepositoryProvisionJob", "RepositoryIssuanceHistory",
  "CollectionRepositoryYearAggregate", "CollectionContributorYearAggregate"
  IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMPORARY TABLE github_scope_retirement ON COMMIT DROP AS
SELECT repository.id
FROM "GithubRepository" repository
LEFT JOIN "Application" application ON application.id = repository."applicationId"
WHERE COALESCE(repository."teamId", application."teamId") IS NULL;

DO $$
DECLARE
  expected record;
  actual bigint;
  existing_table record;
  has_application_data boolean := false;
BEGIN
  IF EXISTS (
    SELECT 1 FROM "GithubRepository" repository
    JOIN "Application" application ON application.id = repository."applicationId"
    WHERE repository."teamId" IS NOT NULL
      AND application."teamId" IS NOT NULL
      AND repository."teamId" <> application."teamId"
  ) THEN
    RAISE EXCEPTION 'github scope retirement: repository and application team mismatch';
  END IF;

  FOR existing_table IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'
  LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %I.%I)',
      current_schema(), existing_table.tablename
    ) INTO has_application_data;
    EXIT WHEN has_application_data;
  END LOOP;

  -- Only a database with no application data is a fresh installation.
  -- Zero repositories in a populated database is a scope mismatch.
  IF has_application_data THEN
    FOR expected IN SELECT * FROM (VALUES
      ('GithubRepository', 12),
      ('CollectionCommitFact', 167),
      ('Contribution', 25),
      ('CollectionRepositoryStream', 40),
      ('CollectionPullRequestFact', 15),
      ('CollectionReleaseFact', 9),
      ('GithubRepositoryOutsiderContribution', 1),
      ('RepositoryInvitation', 9),
      ('CollectionRepositoryYearAggregate', 1),
      ('CollectionContributorYearAggregate', 2),
      ('GithubIssueHistory', 0),
      ('RepositoryProvisionJob', 0),
      ('RepositoryIssuanceHistory', 0)
    ) AS approved(table_name, row_count)
    LOOP
      EXECUTE format(
        'SELECT count(*) FROM %I WHERE %I IN (SELECT id FROM github_scope_retirement)',
        expected.table_name,
        CASE WHEN expected.table_name = 'GithubRepository' THEN 'id' ELSE 'repositoryId' END
      ) INTO actual;
      IF actual <> expected.row_count THEN
        RAISE EXCEPTION 'github scope retirement: % expected %, found %',
          expected.table_name, expected.row_count, actual;
      END IF;
    END LOOP;
  END IF;
END $$;

UPDATE "GithubRepository" repository
SET "teamId" = application."teamId"
FROM "Application" application
WHERE repository."applicationId" = application.id
  AND repository."teamId" IS NULL
  AND application."teamId" IS NOT NULL;

CREATE UNIQUE INDEX "GithubRepository_teamId_key"
  ON "GithubRepository" ("teamId") WHERE "teamId" IS NOT NULL;

DELETE FROM "RepositoryInvitation"
WHERE "repositoryId" IN (SELECT id FROM github_scope_retirement);

-- Existing ON DELETE CASCADE foreign keys remove only the selected collection
-- rows, including the two legacy annual aggregate tables. Keep those tables.
-- AuditLog has no FK and is intentionally retained for Todo 10.
DELETE FROM "GithubRepository"
WHERE id IN (SELECT id FROM github_scope_retirement);

COMMIT;
