#!/usr/bin/env bash
# legacy-submission 3단 이관(#1034) 리허설.
#
# `migrate`  — 데이터가 있는 DB에서 expand → bridge → contract가 손실 없이 통과하고
#              이관 전후의 행 수·매핑이 기대와 같은지 증명한다.
# `negative` — contract의 preflight 게이트 아홉 개가 각각 파괴적 DDL **이전에**
#              멈추는지, 그리고 멈춘 뒤 되돌릴 표면이 남아 있는지 증명한다.
#
# 두 시나리오 모두 일회용 PostgreSQL 컨테이너를 직접 소유하고 끝나면 지운다.
# 호출자의 DATABASE_URL을 읽지 않으므로 개발자·운영 DB에 붙을 경로가 없다.
#
# 로컬·E2E·CI는 매번 빈 데이터베이스에 마이그레이션을 적용하므로 bridge의 복사
# 로직과 contract의 게이트는 그 경로에서 단 한 행도 처리해보지 않는다. 이 스크립트가
# 그 빈자리를 메운다. 실행 시점과 실패 시 복구 절차는 docs/deploy/pre-deploy-verify.md.
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
# negative 레인이 게이트 문구를 읽으려고 직접 돌리는 원본 SQL — 스테이징 트리가 아니라
# 저장소의 추적 중인 파일이다.
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
  # `-v`로 익명 볼륨까지 함께 지운다 — 컨테이너만 지우면 볼륨이 남는다.
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

# 데이터베이스 이름은 `oss_hub_test`가 아니어야 한다. bridge가 심는 두 트리거는
# 그 이름에서 스스로 비켜서므로, 그 이름으로 돌면 fence가 꺼진 리허설이 된다.
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

# 세 단계를 하나씩 꺼내 붙이며 배포한다. 한 번의 deploy로 몰면 bridge와 contract
# 사이에 데이터를 흔들 자리가 없어 preflight 게이트를 하나도 겨눌 수 없다.
#
# Prisma는 schema 파일 위치에서 migrations 경로를 파생하므로, 아직 적용하지 않을
# 디렉터리를 빼둔 스테이징 트리에 schema를 함께 둔다. 프로세스 치환 fallback은
# 항상 실패하고 stderr를 삼켜 진짜 오류를 숨기므로 두지 않는다.
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

# bridge 이후에만 만들 수 있는 모양이다. bridge의 대사 검증은 source 연결이 있는
# 파일 수를 세므로, 그 이전에 seed 파일에 target provenance를 붙이면 그 대사가
# 어긋난다. 실제로도 이 모양은 bridge 뒤 seed 그래프를 세우는 post-migration CI가
# 만든다 — fence가 예약 접두사 행의 쓰기를 열어 두는 이유가 그것이다.
link_seed_file_to_target() {
  psql_exec >/dev/null <<'SQL'
UPDATE "SubmissionFile"
SET "milestoneDocumentSubmissionId" = 'seed:legacy-submission:document-submission:target',
    "milestoneDocumentSubmissionHistoryId" = 'seed:legacy-submission:document-history:target'
WHERE "id" = 'seed:legacy-submission:file:mapped';
SQL
}

# 이관 전 원본에서 계산한 기대 매핑. contract가 원본 테이블을 지운 뒤에는 다시
# 만들 수 없으므로 반드시 이관 전에 떠 둔다.
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

# 이관이 손대면 안 되는 대조군. 원장 이관은 legacy 그래프만 옮기므로 여기 한 행도
# 움직여서는 안 된다.
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

# 세 단계 직전 상태까지 먼저 적용한다 — 그 상태가 이관 당시의 생산 스키마다.
deploy >/dev/null
seed_fixture
stage "$expand_dir"
deploy >/dev/null

# 이관 전 원본 상태. contract 이후에는 원본이 없으므로 여기서만 뜰 수 있다.
submissions_before=$(psql_value 'SELECT count(*) FROM "Submission" AS s JOIN "Application" AS a ON a."id" = s."applicationId" WHERE NOT (s."id" LIKE '"'"'seed:%'"'"' AND a."id" LIKE '"'"'seed:%'"'"')')
revisions_before=$(psql_value 'SELECT count(*) FROM "SubmissionRevision" AS r JOIN "Submission" AS s ON s."id" = r."submissionId" JOIN "Application" AS a ON a."id" = s."applicationId" WHERE NOT (s."id" LIKE '"'"'seed:%'"'"' AND a."id" LIKE '"'"'seed:%'"'"')')
reviews_before=$(psql_value 'SELECT count(*) FROM "Review" AS v JOIN "SubmissionRevision" AS r ON r."id" = v."submissionRevisionId" JOIN "Submission" AS s ON s."id" = r."submissionId" JOIN "Application" AS a ON a."id" = s."applicationId" WHERE NOT (s."id" LIKE '"'"'seed:%'"'"' AND a."id" LIKE '"'"'seed:%'"'"')')
files_before=$(psql_value 'SELECT count(*) FROM "SubmissionFile"')
mapping_before=$(source_header_digest)
history_before=$(source_history_digest)
review_before=$(source_review_digest)
control_before=$(control_digest)

# 빈 테이블 위에서는 bridge의 복사도 contract의 게이트도 아무것도 증명하지 못한다.
[[ "$submissions_before" -gt 0 && "$revisions_before" -gt "$submissions_before" && "$reviews_before" -gt 0 ]] ||
  fail "fixture must seed multi-revision, reviewed source submissions (submissions=$submissions_before revisions=$revisions_before reviews=$reviews_before)"
# 빈 다이제스트끼리는 무엇과도 같으므로 대조가 조용히 참이 된다.
for digest in "$mapping_before" "$history_before" "$review_before" "$control_before"; do
  [[ -n "$digest" ]] || fail 'a pre-migration digest came back empty — the comparison would pass vacuously'
done

stage "$bridge_dir"
deploy >/dev/null
link_seed_file_to_target
stage "$contract_dir"

if [[ $scenario == 'migrate' ]]; then
  # bridge 이후 원본은 정말 잠겨야 한다. fence가 꺼져 있으면 배포 도중 옛 이미지가
  # 원본을 계속 갈라도 아무도 모른 채 contract가 그 위에서 돈다.
  fence_error=$(psql_exec 2>&1 >/dev/null <<'SQL' || true
UPDATE "Submission" SET "status" = 'APPROVED'
WHERE "id" = 'fixture:legacy-submission:submission:fenced';
SQL
  )
  [[ "$fence_error" == *'legacy submission source is read only after bridge'* ]] ||
    fail "bridge write fence did not reject a source mutation
  $fence_error"

  # 파괴적 DDL **이전에** 백업을 뜬다. Prisma에는 down 마이그레이션이 없고 배포
  # 경로에 자동 복원도 없으므로 이 덤프가 되돌릴 유일한 근거다.
  backup=$(mktemp -d "${TMPDIR:-/tmp}/legacy-submission-backup.XXXXXX")
  docker exec -e PGPASSWORD="$password" "$container" \
    pg_dump -U migration -d legacy_submission_rehearsal --format=custom \
    >"$backup/pre-contract.dump"
  [[ -s "$backup/pre-contract.dump" ]] || fail 'pre-contract backup is empty'

  apply_contract >/dev/null

  # [1] 원본 세 테이블과 source FK 칸이 실제로 사라졌는가.
  for gone in 'Review' 'SubmissionRevision' 'Submission'; do
    [[ "$(relation_count "$gone")" == '0' ]] || fail "$gone table survived contract"
  done
  legacy_column=$(psql_value "SELECT count(*) FROM information_schema.columns WHERE table_name='SubmissionFile' AND column_name='submissionRevisionId'")
  [[ "$legacy_column" == '0' ]] || fail 'SubmissionFile."submissionRevisionId" survived contract'

  # [2] 행 수가 원장을 건너 그대로 이어졌는가.
  headers_after=$(psql_value 'SELECT count(*) FROM "MilestoneDocumentSubmission" WHERE "legacySubmissionId" IS NOT NULL')
  histories_after=$(psql_value 'SELECT count(*) FROM "MilestoneDocumentSubmissionHistory" WHERE "id" LIKE '"'"'legacy\_submission\_revision\_%'"'"'')
  reviews_after=$(psql_value 'SELECT count(*) FROM "MilestoneDocumentReviewHistory" WHERE "id" LIKE '"'"'legacy\_review\_%'"'"' AND "id" NOT LIKE '"'"'legacy\_review\_event\_%'"'"'')
  review_events_after=$(psql_value 'SELECT count(*) FROM "MilestoneDocumentSubmissionHistory" WHERE "id" LIKE '"'"'legacy\_review\_event\_%'"'"'')
  files_after=$(psql_value 'SELECT count(*) FROM "SubmissionFile"')
  expect_equal 'submission count' "$submissions_before" "$headers_after"
  expect_equal 'revision count' "$revisions_before" "$histories_after"
  expect_equal 'review count' "$reviews_before" "$reviews_after"
  # 검토 한 건은 검토 이력 한 행과 사건 이력 한 행을 함께 남긴다.
  expect_equal 'review event count' "$reviews_before" "$review_events_after"
  # 파일은 한 행도 지우지 않는다 — 객체 정리는 비동기 청소기가 따로 한다.
  expect_equal 'submission file count' "$files_before" "$files_after"

  # [3] 개별 매핑이 기대와 같은가. 수만 맞고 짝이 어긋나는 이관을 수 비교는 못 잡는다.
  mapping_after=$(target_header_digest)
  history_after=$(target_history_digest)
  review_after=$(target_review_digest)
  control_after=$(control_digest)
  expect_equal 'header mapping' "$mapping_before" "$mapping_after"
  expect_equal 'revision mapping' "$history_before" "$history_after"
  expect_equal 'review mapping' "$review_before" "$review_after"
  expect_equal 'untouched control ledger' "$control_before" "$control_after"

  # [4] seed 업로드 두 갈래가 각각 제 길로 갔는가. 대상 원장이 이미 보존한 파일은
  #     lifecycle을 유지하고, 대상이 없는 파일만 비동기 삭제 대기로 넘어간다.
  mapped_lifecycle=$(psql_value 'SELECT "lifecycle" FROM "SubmissionFile" WHERE "id" = '"'"'seed:legacy-submission:file:mapped'"'"'')
  orphan_lifecycle=$(psql_value 'SELECT "lifecycle" FROM "SubmissionFile" WHERE "id" = '"'"'seed:legacy-submission:file:orphan'"'"'')
  [[ "$mapped_lifecycle" == 'ATTACHED' ]] || fail "target-preserved seed upload changed lifecycle to $mapped_lifecycle"
  [[ "$orphan_lifecycle" == 'DELETE_PENDING' ]] || fail "targetless seed upload was left at $orphan_lifecycle"

  # [5] 백업 복원이 실제로 계약 이전 상태를 되살리는가. 이것이 되돌릴 유일한 경로다.
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

# negative — 게이트 아홉 개가 각각 파괴적 DDL 이전에 멈추는지 증명한다.
#
# 레인마다 bridge 직후 스냅샷으로 되돌린 뒤 위반 하나만 심는다. 한 DB에 위반을
# 쌓으면 앞선 게이트만 걸리고 뒤 게이트는 한 번도 실행되지 않는다.
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

# 거부된 뒤에도 세 테이블과 source FK 칸이 남아 있어야 직전 이미지로 되돌아갈 수 있다.
# Prisma는 마이그레이션 파일 하나를 단일 트랜잭션으로 돌리므로 preflight 실패는
# 파괴적 DDL을 통째로 롤백한다.
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

# 게이트 문구까지 확인한다. "어떤 게이트가 걸렸다"만으로는 아홉 개 각각이 살아
# 있다는 증거가 되지 못한다 — 앞 게이트가 대신 걸린 레인은 뒤 게이트를 검증하지 못한다.
#
# 확인은 두 번에 나눈다. Prisma는 마이그레이션 파일을 한 배치로 보내고 **마지막**
# 오류만 되돌려주므로, 게이트가 낸 원문은 뒤따르는 "current transaction is aborted"
# 에 가려진다. 그래서 어느 게이트가 걸렸는지는 같은 SQL 파일을 psql로 한 번 돌려
# 읽고, 배포 경로가 실제로 멈추는지는 이어지는 `migrate deploy`로 확인한다.
# psql 쪽은 COMMIT에 닿지 못하고 세션이 끝나므로 아무것도 남기지 않는다.
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

# [1/9] 원본 고아 — 복원 누락으로 FK가 빠진 DB가 정확히 이 모양이다.
# 그 위에서 이력이 딸린 revision을 조용히 버려서는 안 된다.
psql_exec >/dev/null <<'SQL'
ALTER TABLE "SubmissionRevision" DROP CONSTRAINT "SubmissionRevision_submissionId_fkey";
UPDATE "SubmissionRevision"
SET "submissionId" = 'fixture-synthetic:legacy-submission:submission:vanished'
WHERE "id" = 'fixture-synthetic:legacy-submission:revision:single:1';
SQL
assert_preflight_aborted \
  'legacy submission source orphan requires reconciliation' \
  'a source revision whose submission is gone'

# [2/9] 현재 회차 불일치 — 헤더가 가리키는 회차의 revision이 없다.
# 배포 도중 옛 이미지가 헤더만 올린 뒤 revision 쓰기에 실패하면 이 모양이 된다.
restore_post_bridge
psql_exec >/dev/null <<'SQL'
UPDATE "Submission" SET "currentRevision" = 99
WHERE "id" = 'fixture-synthetic:legacy-submission:submission:single';
SQL
assert_preflight_aborted \
  'legacy submission current revision requires reconciliation' \
  'a header pointing at a revision that does not exist'

# [3/9] 결정적 target id 충돌 — 평소에는 PK가 이 모양을 막는다.
# 그 PK를 잃은 복원본이 정확히 이 모양이며, 그때 게이트가 마지막 방어선이다.
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

# [4/9] 공개 id 충돌 — 대상 원장의 공개 id가 원본 submission id와 겹친다.
# 두 원장이 id 공간을 나눠 쓰면 legacySubmissionId 역참조가 남의 행을 가리킨다.
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

# [5/9] 헤더 매핑 어긋남 — 복사된 헤더의 상태가 원본과 갈라졌다.
restore_post_bridge
psql_exec >/dev/null <<'SQL'
UPDATE "MilestoneDocumentSubmission" SET "status" = 'REJECTED'
WHERE "legacySubmissionId" = 'fixture-synthetic:legacy-submission:submission:multi';
SQL
assert_preflight_aborted \
  'legacy submission header mapping requires reconciliation' \
  'a bridged header whose status drifted from the source'

# [6/9] 회차 이력 매핑 어긋남 — 복사된 이력의 사유가 원본과 갈라졌다.
restore_post_bridge
psql_exec >/dev/null <<'SQL'
UPDATE "MilestoneDocumentSubmissionHistory" SET "comment" = '합성 드리프트'
WHERE "id" = CONCAT('legacy_submission_revision_', MD5('fixture-synthetic:legacy-submission:revision:multi:2'));
SQL
assert_preflight_aborted \
  'legacy submission revision mapping requires reconciliation' \
  'a bridged revision history whose comment drifted from the source'

# [7/9] 검토 매핑 어긋남 — 복사된 검토 판정이 원본과 갈라졌다.
restore_post_bridge
psql_exec >/dev/null <<'SQL'
UPDATE "MilestoneDocumentReviewHistory" SET "decision" = 'APPROVED'
WHERE "id" = CONCAT('legacy_review_', MD5('fixture-synthetic:legacy-submission:review:multi:1'));
SQL
assert_preflight_aborted \
  'legacy review mapping requires reconciliation' \
  'a bridged review whose decision drifted from the source'

# [8/9] 파일 provenance 어긋남 — 업로드가 다른 회차의 이력에 붙었다.
# 파일이 잘못된 회차에 붙은 채 원본이 사라지면 어느 제출의 첨부였는지 복원할 수 없다.
restore_post_bridge
psql_exec >/dev/null <<'SQL'
UPDATE "SubmissionFile"
SET "milestoneDocumentSubmissionHistoryId" = CONCAT('legacy_submission_revision_', MD5('fixture-synthetic:legacy-submission:revision:multi:2'))
WHERE "id" = 'fixture-synthetic:legacy-submission:file:multi:1';
SQL
assert_preflight_aborted \
  'legacy submission file provenance requires reconciliation' \
  'a bridged upload attached to the wrong revision history'

# [9/9] seed 업로드의 대상 provenance 어긋남 — 폐기 대상 업로드가 남의 신청 대상에 붙었다.
# contract는 seed 업로드만 lifecycle을 바꾸므로 그 대상 판정이 틀리면 남의 파일을 건드린다.
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
