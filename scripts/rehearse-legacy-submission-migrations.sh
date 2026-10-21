#!/usr/bin/env bash
set -euo pipefail

scenario=${1:-}
if [[ $# -ne 1 ]] || [[ $scenario != 'migrate' && $scenario != 'negative' ]]; then
  printf 'Usage: scripts/rehearse-legacy-submission-migrations.sh migrate|negative\n' >&2
  exit 2
fi

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
backend="$repo_root/apps/backend"
fixture="$backend/prisma/fixtures/legacy-submission-rehearsal.sql"
expand_dir='20260830050000_expand_legacy_submission_bridge'
bridge_dir='20260830100000_bridge_legacy_submissions'
contract_dir='20260830180000_contract_legacy_submissions'
contract_sql="$backend/prisma/migrations/$contract_dir/migration.sql"

container="oss-hub-legacy-submission-$(date +%s)-$$-$RANDOM"
password='synthetic-rehearsal-password'
database='legacy_submission_rehearsal'
port=''
staged=''
backup=''

cleanup() {
  local status=$?
  trap - EXIT
  docker rm -f -v "$container" >/dev/null 2>&1 || true
  if [[ -n ${staged:-} ]]; then
    rm -rf -- "$staged"
  fi
  if [[ -n ${backup:-} ]]; then
    rm -rf -- "$backup"
  fi
  exit "$status"
}
trap cleanup EXIT

docker run -d --name "$container" \
  -e POSTGRES_USER=migration \
  -e POSTGRES_PASSWORD="$password" \
  -e POSTGRES_DB=legacy_submission_rehearsal \
  -p 0:5432 postgres:17-alpine >/dev/null
port=$(docker port "$container" 5432/tcp | head -1 | sed 's/.*://')
database_url="postgresql://migration:${password}@127.0.0.1:${port}/${database}?schema=public"

for _ in $(seq 1 60); do
  if docker exec "$container" pg_isready -U migration -d "$database" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$container" pg_isready -U migration -d "$database" >/dev/null

psql_exec() {
  docker exec -i -e PGPASSWORD="$password" "$container" \
    psql -v ON_ERROR_STOP=1 -U migration -d "$database" "$@"
}

psql_value() {
  psql_exec -tA -c "$1"
}

staged=$(mktemp -d "${TMPDIR:-/tmp}/legacy-submission-staged.XXXXXX")
cp -R "$backend/prisma/migrations" "$staged/migrations"
cp "$backend/prisma/schema.prisma" "$staged/schema.prisma"
mkdir -p "$staged/pending"
for pending_dir in "$expand_dir" "$bridge_dir" "$contract_dir"; do
  mv "$staged/migrations/$pending_dir" "$staged/pending/$pending_dir"
done

deploy() {
  (cd "$backend" && DATABASE_URL="$database_url" \
    pnpm exec prisma migrate deploy --schema "$staged/schema.prisma")
}

stage() {
  mv "$staged/pending/$1" "$staged/migrations/$1"
}

apply_contract() {
  deploy
}

seed_fixture() {
  psql_exec <"$fixture" >/dev/null
}

link_seed_file_to_target() {
  psql_exec >/dev/null <<'SQL'
UPDATE "SubmissionFile"
SET "milestoneDocumentSubmissionId" = 'seed:legacy-submission:document-submission:target',
    "milestoneDocumentSubmissionHistoryId" = 'seed:legacy-submission:document-history:target'
WHERE "id" = 'seed:legacy-submission:file:mapped';
SQL
}

source_header_digest() {
  psql_exec -tA <<'SQL'
SELECT string_agg(
  CONCAT('legacy_submission_', MD5(submission."id")) || '|' || submission."status"
    || '|' || submission."currentRevision" || '|' || submission."applicationId",
  ',' ORDER BY submission."id")
FROM "Submission" AS submission
JOIN "Application" AS application ON application."id" = submission."applicationId"
WHERE NOT (submission."id" LIKE 'seed:%' AND application."id" LIKE 'seed:%');
SQL
}

target_header_digest() {
  psql_exec -tA <<'SQL'
SELECT string_agg(
  target."id" || '|' || target."status" || '|' || target."revision"
    || '|' || target."applicationId",
  ',' ORDER BY target."legacySubmissionId")
FROM "MilestoneDocumentSubmission" AS target
WHERE target."legacySubmissionId" IS NOT NULL;
SQL
}

source_history_digest() {
  psql_exec -tA <<'SQL'
SELECT string_agg(
  CONCAT('legacy_submission_revision_', MD5(revision."id")) || '|' || revision."revision"
    || '|' || COALESCE(revision."comment", '<null>'),
  ',' ORDER BY MD5(revision."id"))
FROM "SubmissionRevision" AS revision
JOIN "Submission" AS submission ON submission."id" = revision."submissionId"
JOIN "Application" AS application ON application."id" = submission."applicationId"
WHERE NOT (submission."id" LIKE 'seed:%' AND application."id" LIKE 'seed:%');
SQL
}

target_history_digest() {
  psql_exec -tA <<'SQL'
SELECT string_agg(
  history."id" || '|' || history."revision" || '|' || COALESCE(history."comment", '<null>'),
  ',' ORDER BY history."id")
FROM "MilestoneDocumentSubmissionHistory" AS history
WHERE history."id" LIKE 'legacy\_submission\_revision\_%';
SQL
}

source_review_digest() {
  psql_exec -tA <<'SQL'
SELECT string_agg(
  CONCAT('legacy_review_', MD5(review."id")) || '|' || review."decision"
    || '|' || review."reviewerId",
  ',' ORDER BY MD5(review."id"))
FROM "Review" AS review
JOIN "SubmissionRevision" AS revision ON revision."id" = review."submissionRevisionId"
JOIN "Submission" AS submission ON submission."id" = revision."submissionId"
JOIN "Application" AS application ON application."id" = submission."applicationId"
WHERE NOT (submission."id" LIKE 'seed:%' AND application."id" LIKE 'seed:%');
SQL
}

target_review_digest() {
  psql_exec -tA <<'SQL'
SELECT string_agg(
  target_review."id" || '|' || target_review."decision" || '|' || target_review."reviewerId",
  ',' ORDER BY target_review."id")
FROM "MilestoneDocumentReviewHistory" AS target_review
WHERE target_review."id" LIKE 'legacy\_review\_%'
  AND target_review."id" NOT LIKE 'legacy\_review\_event\_%';
SQL
}

control_digest() {
  psql_exec -tA <<'SQL'
SELECT string_agg(target."id" || '|' || target."status" || '|' || target."revision", ',' ORDER BY target."id")
FROM "MilestoneDocumentSubmission" AS target
WHERE target."id" NOT LIKE 'legacy\_submission\_%';
SQL
}

relation_count() {
  psql_value "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='$1'"
}

fail() {
  printf '%s: %s\n' "$scenario" "$1" >&2
  exit 1
}

expect_equal() {
  [[ "$2" == "$3" ]] || fail "$1 drifted
  before=$2
  after=$3"
}

deploy >/dev/null
seed_fixture
stage "$expand_dir"
deploy >/dev/null

submissions_before=$(psql_value 'SELECT count(*) FROM "Submission" AS s JOIN "Application" AS a ON a."id" = s."applicationId" WHERE NOT (s."id" LIKE '"'"'seed:%'"'"' AND a."id" LIKE '"'"'seed:%'"'"')')
revisions_before=$(psql_value 'SELECT count(*) FROM "SubmissionRevision" AS r JOIN "Submission" AS s ON s."id" = r."submissionId" JOIN "Application" AS a ON a."id" = s."applicationId" WHERE NOT (s."id" LIKE '"'"'seed:%'"'"' AND a."id" LIKE '"'"'seed:%'"'"')')
reviews_before=$(psql_value 'SELECT count(*) FROM "Review" AS v JOIN "SubmissionRevision" AS r ON r."id" = v."submissionRevisionId" JOIN "Submission" AS s ON s."id" = r."submissionId" JOIN "Application" AS a ON a."id" = s."applicationId" WHERE NOT (s."id" LIKE '"'"'seed:%'"'"' AND a."id" LIKE '"'"'seed:%'"'"')')
files_before=$(psql_value 'SELECT count(*) FROM "SubmissionFile"')
mapping_before=$(source_header_digest)
history_before=$(source_history_digest)
review_before=$(source_review_digest)
control_before=$(control_digest)

[[ "$submissions_before" -gt 0 && "$revisions_before" -gt "$submissions_before" && "$reviews_before" -gt 0 ]] ||
  fail "fixture must seed multi-revision, reviewed source submissions (submissions=$submissions_before revisions=$revisions_before reviews=$reviews_before)"
for digest in "$mapping_before" "$history_before" "$review_before" "$control_before"; do
  [[ -n "$digest" ]] || fail 'a pre-migration digest came back empty — the comparison would pass vacuously'
done

stage "$bridge_dir"
deploy >/dev/null
link_seed_file_to_target
stage "$contract_dir"

if [[ $scenario == 'migrate' ]]; then
  fence_error=$(psql_exec 2>&1 >/dev/null <<'SQL' || true
UPDATE "Submission" SET "status" = 'APPROVED'
WHERE "id" = 'fixture:legacy-submission:submission:fenced';
SQL
  )
  [[ "$fence_error" == *'legacy submission source is read only after bridge'* ]] ||
    fail "bridge write fence did not reject a source mutation
  $fence_error"

  backup=$(mktemp -d "${TMPDIR:-/tmp}/legacy-submission-backup.XXXXXX")
  docker exec -e PGPASSWORD="$password" "$container" \
    pg_dump -U migration -d legacy_submission_rehearsal --format=custom \
    >"$backup/pre-contract.dump"
  [[ -s "$backup/pre-contract.dump" ]] || fail 'pre-contract backup is empty'

  apply_contract >/dev/null

  for gone in 'Review' 'SubmissionRevision' 'Submission'; do
    [[ "$(relation_count "$gone")" == '0' ]] || fail "$gone table survived contract"
  done
  legacy_column=$(psql_value "SELECT count(*) FROM information_schema.columns WHERE table_name='SubmissionFile' AND column_name='submissionRevisionId'")
  [[ "$legacy_column" == '0' ]] || fail 'SubmissionFile."submissionRevisionId" survived contract'

  headers_after=$(psql_value 'SELECT count(*) FROM "MilestoneDocumentSubmission" WHERE "legacySubmissionId" IS NOT NULL')
  histories_after=$(psql_value 'SELECT count(*) FROM "MilestoneDocumentSubmissionHistory" WHERE "id" LIKE '"'"'legacy\_submission\_revision\_%'"'"'')
  reviews_after=$(psql_value 'SELECT count(*) FROM "MilestoneDocumentReviewHistory" WHERE "id" LIKE '"'"'legacy\_review\_%'"'"' AND "id" NOT LIKE '"'"'legacy\_review\_event\_%'"'"'')
  review_events_after=$(psql_value 'SELECT count(*) FROM "MilestoneDocumentSubmissionHistory" WHERE "id" LIKE '"'"'legacy\_review\_event\_%'"'"'')
  files_after=$(psql_value 'SELECT count(*) FROM "SubmissionFile"')
  expect_equal 'submission count' "$submissions_before" "$headers_after"
  expect_equal 'revision count' "$revisions_before" "$histories_after"
  expect_equal 'review count' "$reviews_before" "$reviews_after"
  expect_equal 'review event count' "$reviews_before" "$review_events_after"
  expect_equal 'submission file count' "$files_before" "$files_after"

  mapping_after=$(target_header_digest)
  history_after=$(target_history_digest)
  review_after=$(target_review_digest)
  control_after=$(control_digest)
  expect_equal 'header mapping' "$mapping_before" "$mapping_after"
  expect_equal 'revision mapping' "$history_before" "$history_after"
  expect_equal 'review mapping' "$review_before" "$review_after"
  expect_equal 'untouched control ledger' "$control_before" "$control_after"

  mapped_lifecycle=$(psql_value 'SELECT "lifecycle" FROM "SubmissionFile" WHERE "id" = '"'"'seed:legacy-submission:file:mapped'"'"'')
  orphan_lifecycle=$(psql_value 'SELECT "lifecycle" FROM "SubmissionFile" WHERE "id" = '"'"'seed:legacy-submission:file:orphan'"'"'')
  [[ "$mapped_lifecycle" == 'ATTACHED' ]] || fail "target-preserved seed upload changed lifecycle to $mapped_lifecycle"
  [[ "$orphan_lifecycle" == 'DELETE_PENDING' ]] || fail "targetless seed upload was left at $orphan_lifecycle"

  psql_exec -q -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' >/dev/null 2>&1
  docker exec -i -e PGPASSWORD="$password" "$container" \
    pg_restore -U migration -d legacy_submission_rehearsal --no-owner \
    <"$backup/pre-contract.dump" >/dev/null 2>&1
  for restored in 'Review' 'SubmissionRevision' 'Submission'; do
    [[ "$(relation_count "$restored")" == '1' ]] || fail "restore did not bring back $restored"
  done
  expect_equal 'restored header mapping' "$mapping_before" "$(source_header_digest)"

  printf '{"status":"ok","scenario":"migrate","submissions":%s,"revisions":%s,"reviews":%s,"files":%s,"restored":true}\n' \
    "$submissions_before" "$revisions_before" "$reviews_before" "$files_before"
  exit 0
fi

backup=$(mktemp -d "${TMPDIR:-/tmp}/legacy-submission-backup.XXXXXX")
docker exec -e PGPASSWORD="$password" "$container" \
  pg_dump -U migration -d legacy_submission_rehearsal --format=custom \
  >"$backup/post-bridge.dump"
[[ -s "$backup/post-bridge.dump" ]] || fail 'post-bridge snapshot is empty'

restore_post_bridge() {
  psql_exec -q -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' >/dev/null 2>&1
  docker exec -i -e PGPASSWORD="$password" "$container" \
    pg_restore -U migration -d legacy_submission_rehearsal --no-owner \
    <"$backup/post-bridge.dump" >/dev/null 2>&1
  [[ "$(relation_count 'Submission')" == '1' ]] ||
    fail 'post-bridge snapshot restore did not bring back the source ledger'
}

assert_rollback_surface() {
  local reason=$1
  for surviving in 'Submission' 'SubmissionRevision' 'Review'; do
    [[ "$(relation_count "$surviving")" == '1' ]] ||
      fail "$surviving was dropped despite the failed preflight ($reason)"
  done
  local column
  column=$(psql_value "SELECT count(*) FROM information_schema.columns WHERE table_name='SubmissionFile' AND column_name='submissionRevisionId'")
  [[ "$column" == '1' ]] ||
    fail "SubmissionFile.\"submissionRevisionId\" was dropped despite the failed preflight ($reason)"
}

lanes=0
assert_preflight_aborted() {
  local gate=$1 reason=$2 output status
  set +e
  output=$(psql_exec <"$contract_sql" 2>&1)
  status=$?
  set -e
  [[ $status -ne 0 ]] || fail "contract SQL accepted $reason"
  [[ "$output" == *"$gate"* ]] || fail "$reason aborted on the wrong gate
  expected: $gate
$output"

  set +e
  apply_contract >/dev/null 2>&1
  status=$?
  set -e
  [[ $status -ne 0 ]] || fail "migrate deploy accepted $reason"

  assert_rollback_surface "$reason"
  lanes=$((lanes + 1))
}

psql_exec >/dev/null <<'SQL'
ALTER TABLE "SubmissionRevision" DROP CONSTRAINT "SubmissionRevision_submissionId_fkey";
UPDATE "SubmissionRevision"
SET "submissionId" = 'fixture-synthetic:legacy-submission:submission:vanished'
WHERE "id" = 'fixture-synthetic:legacy-submission:revision:single:1';
SQL
assert_preflight_aborted \
  'legacy submission source orphan requires reconciliation' \
  'a source revision whose submission is gone'

restore_post_bridge
psql_exec >/dev/null <<'SQL'
UPDATE "Submission" SET "currentRevision" = 99
WHERE "id" = 'fixture-synthetic:legacy-submission:submission:single';
SQL
assert_preflight_aborted \
  'legacy submission current revision requires reconciliation' \
  'a header pointing at a revision that does not exist'

restore_post_bridge
psql_exec >/dev/null <<'SQL'
ALTER TABLE "Submission" DROP CONSTRAINT "Submission_pkey" CASCADE;
DROP INDEX "Submission_applicationId_milestoneId_key";
INSERT INTO "Submission" ("id", "milestoneId", "applicationId", "status", "currentRevision", "createdAt", "updatedAt")
SELECT "id", "milestoneId", "applicationId", "status", "currentRevision", "createdAt", "updatedAt"
FROM "Submission"
WHERE "id" = 'fixture-synthetic:legacy-submission:submission:single';
SQL
assert_preflight_aborted \
  'legacy submission deterministic target id collision requires reconciliation' \
  'two source submissions sharing one deterministic target id'

restore_post_bridge
psql_exec >/dev/null <<'SQL'
INSERT INTO "MilestoneDocument" ("id", "milestoneId", "name", "required", "sortOrder", "createdAt", "updatedAt")
VALUES ('fixture-synthetic:legacy-submission:document:collision', 'fixture-synthetic:legacy-submission:milestone:text', '합성 충돌 문서', TRUE, 1, TIMESTAMP '2026-01-05 00:00:00', TIMESTAMP '2026-01-05 00:00:00');
INSERT INTO "MilestoneDocumentSubmission" ("id", "milestoneDocumentId", "applicationId", "status", "content", "revision", "submittedById", "submittedAt", "createdAt", "updatedAt")
VALUES ('fixture-synthetic:legacy-submission:submission:single', 'fixture-synthetic:legacy-submission:document:collision', 'fixture-synthetic:legacy-submission:application:002', 'SUBMITTED', NULL, 1, 'fixture-synthetic:legacy-submission:user:student', TIMESTAMP '2026-02-01 00:00:00', TIMESTAMP '2026-02-01 00:00:00', TIMESTAMP '2026-02-01 00:00:00');
SQL
assert_preflight_aborted \
  'legacy submission public id collision requires reconciliation' \
  'a target public id colliding with a source submission id'

restore_post_bridge
psql_exec >/dev/null <<'SQL'
UPDATE "MilestoneDocumentSubmission" SET "status" = 'REJECTED'
WHERE "legacySubmissionId" = 'fixture-synthetic:legacy-submission:submission:multi';
SQL
assert_preflight_aborted \
  'legacy submission header mapping requires reconciliation' \
  'a bridged header whose status drifted from the source'

restore_post_bridge
psql_exec >/dev/null <<'SQL'
UPDATE "MilestoneDocumentSubmissionHistory" SET "comment" = '합성 드리프트'
WHERE "id" = CONCAT('legacy_submission_revision_', MD5('fixture-synthetic:legacy-submission:revision:multi:2'));
SQL
assert_preflight_aborted \
  'legacy submission revision mapping requires reconciliation' \
  'a bridged revision history whose comment drifted from the source'

restore_post_bridge
psql_exec >/dev/null <<'SQL'
UPDATE "MilestoneDocumentReviewHistory" SET "decision" = 'APPROVED'
WHERE "id" = CONCAT('legacy_review_', MD5('fixture-synthetic:legacy-submission:review:multi:1'));
SQL
assert_preflight_aborted \
  'legacy review mapping requires reconciliation' \
  'a bridged review whose decision drifted from the source'

restore_post_bridge
psql_exec >/dev/null <<'SQL'
UPDATE "SubmissionFile"
SET "milestoneDocumentSubmissionHistoryId" = CONCAT('legacy_submission_revision_', MD5('fixture-synthetic:legacy-submission:revision:multi:2'))
WHERE "id" = 'fixture-synthetic:legacy-submission:file:multi:1';
SQL
assert_preflight_aborted \
  'legacy submission file provenance requires reconciliation' \
  'a bridged upload attached to the wrong revision history'

restore_post_bridge
psql_exec >/dev/null <<'SQL'
UPDATE "SubmissionFile"
SET "milestoneDocumentSubmissionId" = CONCAT('legacy_submission_', MD5('fixture-synthetic:legacy-submission:submission:multi')),
    "milestoneDocumentSubmissionHistoryId" = CONCAT('legacy_submission_revision_', MD5('fixture-synthetic:legacy-submission:revision:multi:1'))
WHERE "id" = 'seed:legacy-submission:file:mapped';
SQL
assert_preflight_aborted \
  'legacy seed file target provenance requires reconciliation' \
  'a reserved seed upload pointing at another application target'

[[ "$lanes" == '9' ]] || fail "expected nine gate lanes, ran $lanes"
printf '{"status":"ok","scenario":"negative","lanes":%s}\n' "$lanes"
