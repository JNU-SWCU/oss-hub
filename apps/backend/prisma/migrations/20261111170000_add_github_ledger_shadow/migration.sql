BEGIN;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL lock_timeout = '5s';

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE "repo" (
  "github_repo_id" BIGINT NOT NULL,
  "owner_name" TEXT NOT NULL,
  "source" "RepositorySource" NOT NULL,
  "gone_at" TIMESTAMPTZ(3),
  CONSTRAINT "repo_pkey" PRIMARY KEY ("github_repo_id")
);

-- Postgres 17 has no WITHOUT OVERLAPS, so the exclusion constraint is btree_gist.
CREATE TABLE "team_repo" (
  "team_id" TEXT NOT NULL,
  "repo_id" BIGINT NOT NULL,
  "valid_from" TIMESTAMPTZ(3) NOT NULL,
  "valid_to" TIMESTAMPTZ(3),
  "period" tstzrange GENERATED ALWAYS AS (tstzrange("valid_from", "valid_to", '[)')) STORED NOT NULL,
  CONSTRAINT "team_repo_pkey" PRIMARY KEY ("team_id", "repo_id", "valid_from"),
  CONSTRAINT "team_repo_valid_order" CHECK ("valid_to" IS NULL OR "valid_from" < "valid_to"),
  CONSTRAINT "team_repo_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "team_repo_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repo"("github_repo_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "team_repo_repo_id_period_excl" EXCLUDE USING gist ("repo_id" WITH =, "period" WITH &&)
);

CREATE TYPE "contribution_kind" AS ENUM ('commit', 'pull_request', 'issue', 'release');

CREATE TABLE "contribution" (
  "repo_id" BIGINT NOT NULL,
  "kind" "contribution_kind" NOT NULL,
  "github_key" TEXT NOT NULL,
  "author_github_id" BIGINT,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "first_seen_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "contribution_pkey" PRIMARY KEY ("repo_id", "kind", "github_key"),
  CONSTRAINT "contribution_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repo"("github_repo_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "contribution_author_github_id_occurred_at_idx" ON "contribution"("author_github_id", "occurred_at");
CREATE INDEX "contribution_repo_id_occurred_at_idx" ON "contribution"("repo_id", "occurred_at");

CREATE TABLE "github_user_activity_history" (
  "github_id" BIGINT NOT NULL,
  "year" INTEGER NOT NULL,
  "visibility" "ActivityVisibility" NOT NULL,
  "commit_count" INTEGER NOT NULL DEFAULT 0,
  "pull_request_count" INTEGER NOT NULL DEFAULT 0,
  "issue_count" INTEGER NOT NULL DEFAULT 0,
  "repository_count" INTEGER NOT NULL DEFAULT 0,
  "star_count" INTEGER NOT NULL DEFAULT 0,
  "observed_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "github_user_activity_history_pkey" PRIMARY KEY ("github_id", "year", "visibility", "observed_at")
);

COMMIT;
