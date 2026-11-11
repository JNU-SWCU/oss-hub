#!/usr/bin/env bash
# Re-runnable lock measurement for 20261111170000_add_github_ledger_shadow.
# Seeds a scratch database to the reported production scale (Team: tens of rows,
# database: about 13k rows) and prints, per DDL statement, the locks taken on
# existing tables, whether those locks block reads or writes, and how long the
# statement itself held them.
set -euo pipefail

db="${LOCK_MEASURE_DB:-oss_hub_lock_measure}"
log="${LOCK_MEASURE_LOG:-/tmp/ledger-lock-measure.log}"
: >"$log"
psql=(sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d "$db")
psql_postgres=(sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d postgres)

"${psql_postgres[@]}" -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE);"
"${psql_postgres[@]}" -c "CREATE DATABASE \"$db\";"

"${psql[@]}" <<'SQL'
CREATE TABLE "Team" (
  id text PRIMARY KEY,
  payload text NOT NULL
);
INSERT INTO "Team" (id, payload)
SELECT 'team-' || lpad(g::text, 4, '0'), repeat('x', 2048)
FROM generate_series(1, 40) AS g;

CREATE TABLE filler (
  id integer PRIMARY KEY,
  payload text NOT NULL
);
INSERT INTO filler (id, payload)
SELECT g, repeat('y', 32)
FROM generate_series(1, 12960) AS g;

CREATE TYPE "RepositorySource" AS ENUM ('CONNECTED');
CREATE TYPE "ActivityVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

CREATE TABLE sync (
  kind text PRIMARY KEY,
  note text NOT NULL
);
SQL

team_count="$("${psql[@]}" -At -c 'SELECT count(*) FROM "Team"')"
total_count="$("${psql[@]}" -At -c 'SELECT (SELECT count(*) FROM "Team") + (SELECT count(*) FROM filler)')"
echo "scale team_rows=$team_count total_rows=$total_count"

measure_duration() {
  local name="$1"
  local stmt="$2"
  "${psql[@]}" -At <<SQL
BEGIN;
SELECT (clock_timestamp()) AS started \\gset
$stmt
SELECT (clock_timestamp()) AS finished \\gset
SELECT '$name|' || round(extract(epoch FROM (:'finished'::timestamptz - :'started'::timestamptz)) * 1000.0, 3);
COMMIT;
SQL
}

# Hold the statement open on pg_sleep so a second session can read pg_locks and
# try the read lock and the write lock. The sleep is not part of the duration run.
measure_block() {
  local name="$1"
  local stmt="$2"
  "${psql[@]}" >>"$log" 2>&1 <<SQL &
BEGIN;
$stmt
SELECT pg_sleep(1.2);
COMMIT;
SQL
  local holder=$!
  local pid=""
  local attempt
  for attempt in $(seq 1 100); do
    pid="$("${psql[@]}" -At -c "SELECT pid FROM pg_stat_activity WHERE datname = '$db' AND state = 'active' AND query LIKE '%pg_sleep(1.2)%' AND pid <> pg_backend_pid() LIMIT 1")"
    if [[ -n "$pid" ]]; then
      break
    fi
    sleep 0.02
  done
  if [[ -z "$pid" ]]; then
    echo "$name|probe-failed|no sleeping holder" >&2
    wait "$holder" || true
    return 1
  fi
  local locks
  locks="$("${psql[@]}" -At -c "
    SELECT string_agg(c.relname || ':' || l.mode, ',' ORDER BY c.relname, l.mode)
    FROM pg_locks l
    JOIN pg_class c ON c.oid = l.relation
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE l.pid = $pid
      AND l.granted
      AND n.nspname = 'public'
      AND c.relname IN ('Team', 'filler')
  ")"
  local read_result write_result
  if "${psql[@]}" -c "SET lock_timeout = '150ms'; LOCK TABLE \"Team\" IN ACCESS SHARE MODE;" >/dev/null 2>&1; then
    read_result="read-open"
  else
    read_result="read-blocked"
  fi
  if "${psql[@]}" -c "SET lock_timeout = '150ms'; LOCK TABLE \"Team\" IN ROW EXCLUSIVE MODE;" >/dev/null 2>&1; then
    write_result="write-open"
  else
    write_result="write-blocked"
  fi
  wait "$holder"
  echo "$name|${locks:-none}|$read_result|$write_result"
}

echo "--- duration_ms (statement, then commit) ---"
measure_duration "create-extension" "CREATE EXTENSION IF NOT EXISTS btree_gist;"
measure_duration "create-repo" "
CREATE TABLE repo (
  github_repo_id bigint PRIMARY KEY,
  owner_name text NOT NULL
);"
measure_duration "create-team-repo-with-fk" "
CREATE TABLE team_repo (
  team_id text NOT NULL,
  repo_id bigint NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  period tstzrange GENERATED ALWAYS AS (tstzrange(valid_from, valid_to, '[)')) STORED NOT NULL,
  PRIMARY KEY (team_id, repo_id, valid_from),
  CONSTRAINT team_repo_team_id_fkey FOREIGN KEY (team_id) REFERENCES \"Team\"(id),
  CONSTRAINT team_repo_repo_id_fkey FOREIGN KEY (repo_id) REFERENCES repo(github_repo_id),
  CONSTRAINT team_repo_repo_id_period_excl EXCLUDE USING gist (repo_id WITH =, period WITH &&),
  CONSTRAINT team_repo_team_id_period_excl EXCLUDE USING gist (team_id WITH =, period WITH &&)
);"
"${psql[@]}" -c "DROP TABLE IF EXISTS team_repo;" >/dev/null
measure_duration "create-team-repo-without-fk" "
CREATE TABLE team_repo (
  team_id text NOT NULL,
  repo_id bigint NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  period tstzrange GENERATED ALWAYS AS (tstzrange(valid_from, valid_to, '[)')) STORED NOT NULL,
  PRIMARY KEY (team_id, repo_id, valid_from),
  CONSTRAINT team_repo_repo_id_fkey FOREIGN KEY (repo_id) REFERENCES repo(github_repo_id),
  CONSTRAINT team_repo_repo_id_period_excl EXCLUDE USING gist (repo_id WITH =, period WITH &&),
  CONSTRAINT team_repo_team_id_period_excl EXCLUDE USING gist (team_id WITH =, period WITH &&)
);"
measure_duration "add-fk-not-valid" "
ALTER TABLE team_repo
  ADD CONSTRAINT team_repo_team_id_fkey
  FOREIGN KEY (team_id) REFERENCES \"Team\"(id) NOT VALID;"
measure_duration "validate-fk" "ALTER TABLE team_repo VALIDATE CONSTRAINT team_repo_team_id_fkey;"
measure_duration "add-archived-at" "ALTER TABLE \"Team\" ADD COLUMN \"archivedAt\" timestamp(3);"

echo "--- locks held on existing tables while the statement's transaction stays open ---"
"${psql[@]}" -c "ALTER TABLE \"Team\" DROP COLUMN \"archivedAt\";" >/dev/null
"${psql[@]}" -c "DROP TABLE IF EXISTS team_repo;" >/dev/null
"${psql[@]}" -c "DROP EXTENSION IF EXISTS btree_gist;" >/dev/null
measure_block "create-extension" "CREATE EXTENSION IF NOT EXISTS btree_gist;"
measure_block "create-team-repo-with-fk" "
CREATE TABLE team_repo_fk (
  team_id text NOT NULL,
  repo_id bigint NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  period tstzrange GENERATED ALWAYS AS (tstzrange(valid_from, valid_to, '[)')) STORED NOT NULL,
  PRIMARY KEY (team_id, repo_id, valid_from),
  CONSTRAINT team_repo_fk_team_id_fkey FOREIGN KEY (team_id) REFERENCES \"Team\"(id),
  CONSTRAINT team_repo_fk_repo_excl EXCLUDE USING gist (repo_id WITH =, period WITH &&)
);"
"${psql[@]}" -c "DROP TABLE IF EXISTS team_repo_fk;" >/dev/null
"${psql[@]}" -c "
CREATE TABLE team_repo_plain (
  team_id text NOT NULL,
  repo_id bigint NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  period tstzrange GENERATED ALWAYS AS (tstzrange(valid_from, valid_to, '[)')) STORED NOT NULL,
  PRIMARY KEY (team_id, repo_id, valid_from)
);" >/dev/null
measure_block "add-fk-not-valid" "
ALTER TABLE team_repo_plain
  ADD CONSTRAINT team_repo_plain_team_id_fkey
  FOREIGN KEY (team_id) REFERENCES \"Team\"(id) NOT VALID;"
measure_block "validate-fk" "ALTER TABLE team_repo_plain VALIDATE CONSTRAINT team_repo_plain_team_id_fkey;"
measure_block "add-archived-at" "ALTER TABLE \"Team\" ADD COLUMN \"archivedAt\" timestamp(3);"

echo "--- current single-transaction shape: Team lock windows ---"
"${psql[@]}" -c "ALTER TABLE \"Team\" DROP COLUMN IF EXISTS \"archivedAt\";" >/dev/null
"${psql[@]}" -c "DROP TABLE IF EXISTS team_repo_plain, team_repo, repo CASCADE;" >/dev/null
"${psql[@]}" -At <<'SQL'
BEGIN;
SELECT clock_timestamp() AS t0 \gset
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE repo (
  github_repo_id bigint PRIMARY KEY,
  owner_name text NOT NULL,
  source "RepositorySource" NOT NULL,
  gone_at timestamptz
);
SELECT clock_timestamp() AS t_repo \gset
CREATE TABLE team_repo (
  team_id text NOT NULL,
  repo_id bigint NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  period tstzrange GENERATED ALWAYS AS (tstzrange(valid_from, valid_to, '[)')) STORED NOT NULL,
  PRIMARY KEY (team_id, repo_id, valid_from),
  CHECK (valid_to IS NULL OR valid_from < valid_to),
  FOREIGN KEY (team_id) REFERENCES "Team"(id),
  FOREIGN KEY (repo_id) REFERENCES repo(github_repo_id),
  EXCLUDE USING gist (repo_id WITH =, period WITH &&),
  EXCLUDE USING gist (team_id WITH =, period WITH &&)
);
SELECT clock_timestamp() AS t_fk \gset
CREATE TYPE contribution_kind AS ENUM ('commit', 'pull_request', 'issue', 'release');
CREATE TABLE contribution (
  repo_id bigint NOT NULL,
  kind contribution_kind NOT NULL,
  github_key text NOT NULL,
  author_github_id bigint,
  occurred_at timestamptz NOT NULL,
  first_seen_at timestamptz NOT NULL,
  PRIMARY KEY (repo_id, kind, github_key),
  FOREIGN KEY (repo_id) REFERENCES repo(github_repo_id)
);
CREATE INDEX contribution_author_idx ON contribution (author_github_id, occurred_at);
CREATE INDEX contribution_repo_idx ON contribution (repo_id, occurred_at);
CREATE TABLE github_user_activity_history (
  github_id bigint NOT NULL,
  year integer NOT NULL,
  visibility "ActivityVisibility" NOT NULL,
  commit_count integer NOT NULL DEFAULT 0,
  pull_request_count integer NOT NULL DEFAULT 0,
  issue_count integer NOT NULL DEFAULT 0,
  repository_count integer NOT NULL DEFAULT 0,
  star_count integer NOT NULL DEFAULT 0,
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (github_id, year, visibility, observed_at)
);
SELECT clock_timestamp() AS t_before_alter \gset
ALTER TABLE "Team" ADD COLUMN "archivedAt" timestamp(3);
SELECT clock_timestamp() AS t_alter \gset
COMMIT;
SELECT clock_timestamp() AS t_commit \gset
SELECT 'write_block_from_fk_until_commit_ms|' ||
  round(extract(epoch FROM (:'t_commit'::timestamptz - :'t_fk'::timestamptz)) * 1000.0, 3);
SELECT 'read_block_from_alter_until_commit_ms|' ||
  round(extract(epoch FROM (:'t_commit'::timestamptz - :'t_alter'::timestamptz)) * 1000.0, 3);
SELECT 'whole_transaction_ms|' ||
  round(extract(epoch FROM (:'t_commit'::timestamptz - :'t0'::timestamptz)) * 1000.0, 3);
SELECT 'ddl_before_team_fk_ms|' ||
  round(extract(epoch FROM (:'t_fk'::timestamptz - :'t0'::timestamptz)) * 1000.0, 3);
SELECT 'ddl_between_fk_and_alter_ms|' ||
  round(extract(epoch FROM (:'t_before_alter'::timestamptz - :'t_fk'::timestamptz)) * 1000.0, 3);
SQL

echo "--- split shape: new tables without a Team FK, then one-statement locks ---"
"${psql[@]}" -c "DROP TABLE IF EXISTS github_user_activity_history, contribution, team_repo, repo CASCADE; DROP TYPE IF EXISTS contribution_kind;" >/dev/null
"${psql[@]}" -c "ALTER TABLE \"Team\" DROP COLUMN IF EXISTS \"archivedAt\";" >/dev/null
"${psql[@]}" -At <<'SQL'
BEGIN;
SELECT clock_timestamp() AS t0 \gset
CREATE TABLE repo (
  github_repo_id bigint PRIMARY KEY,
  owner_name text NOT NULL,
  source "RepositorySource" NOT NULL,
  gone_at timestamptz
);
CREATE TABLE team_repo (
  team_id text NOT NULL,
  repo_id bigint NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  period tstzrange GENERATED ALWAYS AS (tstzrange(valid_from, valid_to, '[)')) STORED NOT NULL,
  PRIMARY KEY (team_id, repo_id, valid_from),
  CHECK (valid_to IS NULL OR valid_from < valid_to),
  FOREIGN KEY (repo_id) REFERENCES repo(github_repo_id),
  EXCLUDE USING gist (repo_id WITH =, period WITH &&),
  EXCLUDE USING gist (team_id WITH =, period WITH &&)
);
CREATE TYPE contribution_kind AS ENUM ('commit', 'pull_request', 'issue', 'release');
CREATE TABLE contribution (
  repo_id bigint NOT NULL,
  kind contribution_kind NOT NULL,
  github_key text NOT NULL,
  author_github_id bigint,
  occurred_at timestamptz NOT NULL,
  first_seen_at timestamptz NOT NULL,
  PRIMARY KEY (repo_id, kind, github_key),
  FOREIGN KEY (repo_id) REFERENCES repo(github_repo_id)
);
CREATE INDEX contribution_author_idx ON contribution (author_github_id, occurred_at);
CREATE INDEX contribution_repo_idx ON contribution (repo_id, occurred_at);
CREATE TABLE github_user_activity_history (
  github_id bigint NOT NULL,
  year integer NOT NULL,
  visibility "ActivityVisibility" NOT NULL,
  commit_count integer NOT NULL DEFAULT 0,
  pull_request_count integer NOT NULL DEFAULT 0,
  issue_count integer NOT NULL DEFAULT 0,
  repository_count integer NOT NULL DEFAULT 0,
  star_count integer NOT NULL DEFAULT 0,
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (github_id, year, visibility, observed_at)
);
COMMIT;
SELECT clock_timestamp() AS t1 \gset
SELECT 'new_tables_without_team_fk_ms|' ||
  round(extract(epoch FROM (:'t1'::timestamptz - :'t0'::timestamptz)) * 1000.0, 3);
SQL

echo "--- chosen shape: one DO block for the Team foreign key, one for the column ---"
"${psql[@]}" -c "ALTER TABLE team_repo DROP CONSTRAINT IF EXISTS team_repo_team_id_fkey;" >/dev/null
measure_duration "do-add-team-fk" "
DO \$body\$
BEGIN
  PERFORM set_config('lock_timeout', '2s', true);
  EXECUTE 'ALTER TABLE team_repo ADD CONSTRAINT team_repo_team_id_fkey FOREIGN KEY (team_id) REFERENCES \"Team\"(id) ON DELETE RESTRICT ON UPDATE CASCADE';
EXCEPTION
  WHEN lock_not_available THEN
    RAISE EXCEPTION 'OSS_HUB_LOCK_TIMEOUT 55P03';
END
\$body\$;"
"${psql[@]}" -c "ALTER TABLE \"Team\" DROP COLUMN IF EXISTS \"archivedAt\";" >/dev/null
measure_duration "do-add-archived-at" "
DO \$body\$
BEGIN
  PERFORM set_config('lock_timeout', '2s', true);
  EXECUTE 'ALTER TABLE \"Team\" ADD COLUMN \"archivedAt\" timestamp(3)';
EXCEPTION
  WHEN lock_not_available THEN
    RAISE EXCEPTION 'OSS_HUB_LOCK_TIMEOUT 55P03';
END
\$body\$;"
"${psql[@]}" -c "ALTER TABLE team_repo DROP CONSTRAINT IF EXISTS team_repo_team_id_fkey;" >/dev/null
measure_block "do-add-team-fk" "
DO \$body\$
BEGIN
  PERFORM set_config('lock_timeout', '2s', true);
  EXECUTE 'ALTER TABLE team_repo ADD CONSTRAINT team_repo_team_id_fkey FOREIGN KEY (team_id) REFERENCES \"Team\"(id) ON DELETE RESTRICT ON UPDATE CASCADE';
EXCEPTION
  WHEN lock_not_available THEN
    RAISE EXCEPTION 'OSS_HUB_LOCK_TIMEOUT 55P03';
END
\$body\$;"
"${psql[@]}" -c "ALTER TABLE \"Team\" DROP COLUMN \"archivedAt\";" >/dev/null
measure_block "do-add-archived-at" "
DO \$body\$
BEGIN
  PERFORM set_config('lock_timeout', '2s', true);
  EXECUTE 'ALTER TABLE \"Team\" ADD COLUMN \"archivedAt\" timestamp(3)';
EXCEPTION
  WHEN lock_not_available THEN
    RAISE EXCEPTION 'OSS_HUB_LOCK_TIMEOUT 55P03';
END
\$body\$;"

echo "measurement-db=$db"
