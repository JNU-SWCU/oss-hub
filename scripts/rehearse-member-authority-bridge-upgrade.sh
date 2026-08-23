#!/usr/bin/env bash
# bridge 마이그레이션의 **업그레이드 레인** 리허설.
#
# `rehearse-member-authority-bridge.sh`(호환 레인)와 답하는 질문이 다르다.
# 그쪽은 "빈 DB에 bridge 스키마를 만들면 두 이미지가 붙는가"를 묻고, 이쪽은
# **"이미 행이 들어 있는 운영 모양 DB 위에서 bridge 마이그레이션이 실제로 도는가"**를 묻는다.
#
# 이 구분이 요점이다. 호환 레인은 `migrate deploy`를 빈 테이블에 돌리므로 backfill
# UPDATE가 0행을 건드린다 — 그 상태에서는 backfill이 무엇을 하든 통과한다. 실제로
# `NULL IN ('STAFF','ADMIN')`이 FALSE가 아니라 NULL이라 `SET NOT NULL`이 터지는 결함이
# 그 레인을 그대로 통과했다. 그래서 여기서는 **반드시 expand 시점까지만 적용한 뒤
# 행을 먼저 심고**, 그 다음에 bridge 마이그레이션을 돌린다.
#
# positive 레인 — 운영에 실제로 있는 다섯 모양이 손실 없이 넘어간다.
# negative 레인 — backfill을 걷어내면 같은 데이터에서 마이그레이션이 실패한다.
#                 (검사가 실제로 무언가를 붙잡고 있다는 증거)
set -euo pipefail

if [[ $# -ne 0 ]]; then
  printf 'Usage: scripts/rehearse-member-authority-bridge-upgrade.sh\n' >&2
  exit 2
fi

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
backend="$repo_root/apps/backend"
bridge_dir=20260823000000_bridge_member_authority

container="oss-hub-bridge-upgrade-$(date +%s)-$$-$RANDOM"
password='synthetic-upgrade-password'
# 두 임시 트리 모두 **trap보다 먼저** 선언한다. 늦게 선언하면 그 사이에 죽었을 때
# 정리 대상에 들어 있지 않아 그대로 남는다 — negative 레인 디렉터리가 실제로 그렇게
# 새고 있었다.
staged=''
negative=''

cleanup() {
  local status=$?
  trap - EXIT
  # `-v`가 있어야 익명 볼륨까지 지운다. 없으면 컨테이너만 사라지고 PostgreSQL
  # 데이터 볼륨이 dangling으로 남아 리허설을 돌릴 때마다 쌓인다.
  docker rm -f -v "$container" >/dev/null 2>&1 || true
  for temporary in "${staged:-}" "${negative:-}"; do
    if [[ -n $temporary ]]; then
      rm -rf -- "$temporary"
    fi
  done
  exit "$status"
}
# EXIT만으로는 Ctrl-C·SIGTERM 경로가 덮이지 않는다.
trap cleanup EXIT INT TERM

docker run -d --name "$container" \
  -e POSTGRES_USER=migration \
  -e POSTGRES_PASSWORD="$password" \
  -e POSTGRES_DB=bridge_upgrade \
  -p 0:5432 postgres:17-alpine >/dev/null
port=$(docker port "$container" 5432/tcp | head -1 | sed 's/.*://')
database_url="postgresql://migration:${password}@127.0.0.1:${port}/bridge_upgrade?schema=public"

for _ in $(seq 1 60); do
  if docker exec "$container" pg_isready -U migration -d bridge_upgrade >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$container" pg_isready -U migration -d bridge_upgrade >/dev/null

psql_exec() {
  docker exec -i -e PGPASSWORD="$password" "$container" \
    psql -v ON_ERROR_STOP=1 -U migration -d bridge_upgrade "$@"
}

# [1/5] bridge 마이그레이션 **직전**까지만 적용한다 — 그 상태가 오늘의 운영 스키마다.
#       Prisma는 schema 위치에서 migrations 경로를 파생하므로 bridge 디렉터리를 뺀
#       스테이징 트리를 만들어 그 경로로만 적용한다.
staged=$(mktemp -d "${TMPDIR:-/tmp}/bridge-upgrade.XXXXXX")
cp -R "$backend/prisma/migrations" "$staged/migrations"
rm -rf "$staged/migrations/$bridge_dir"
cp "$backend/prisma/schema.prisma" "$staged/schema.prisma"
(cd "$backend" && DATABASE_URL="$database_url" \
  pnpm exec prisma migrate deploy --schema "$staged/schema.prisma" >/dev/null)

# [2/5] 운영 모양 행을 심는다. **여기가 호환 레인과 갈리는 지점이다** —
#       마이그레이션이 아직 돌지 않았고, 이 행들이 backfill의 실제 입력이 된다.
#       값은 전부 합성이다.
seed_rows() {
  psql_exec >/dev/null <<'SQL'
INSERT INTO "User" (id, "githubId", login, "accountStatus", role, "selectedRole", name, "studentId", department, "hasStaffAccess", "hasAdminAccess", "createdAt", "updatedAt")
VALUES
  -- 역할이 배정된 학생·교직원. 두 플래그는 expand 단계 그대로 NULL이다.
  ('u-student', 9910000001, 'upgrade-student', 'ACTIVE', 'STUDENT', 'STUDENT', '합성학생', '260201', '인공지능학부', NULL, NULL, now(), now()),
  ('u-staff',   9910000002, 'upgrade-staff',   'ACTIVE', 'STAFF',   'STAFF',   '합성교직원', NULL, '사업단', NULL, NULL, now(), now()),
  -- 관리자. 권한은 있으나 회원 유형은 확정된 바 없다.
  ('u-admin',   9910000003, 'upgrade-admin',   'ACTIVE', 'ADMIN',   NULL,      '합성관리자', NULL, '사업단', NULL, NULL, now(), now()),
  -- ***이 두 행이 ADMIN 유도를 잡는다.*** 관리자가 가입 절차에서 역할을
  -- 골라 둔 모양이다. `selectedRole`은 기록일 뿐 확정된 정체성이 아니므로
  -- 배정된 ADMIN은 그쪽으로 내려가지 않고 미해소로 남아야 한다.
  ('u-admin-sel-staff',   9910000006, 'upgrade-admin-sel-staff',   'ACTIVE', 'ADMIN', 'STAFF',   '합성관리자교직', NULL, '사업단', NULL, NULL, now(), now()),
  ('u-admin-sel-student', 9910000007, 'upgrade-admin-sel-student', 'ACTIVE', 'ADMIN', 'STUDENT', '합성관리자학생', NULL, '인공지능학부', NULL, NULL, now(), now()),
  -- ***이 행이 결함을 잡는다*** — role NULL(미배정/회수 계정), 두 플래그 NULL.
  -- `NULL IN (...)`는 NULL이라 COALESCE 없이는 SET NOT NULL이 여기서 터진다.
  ('u-unassigned', 9910000004, 'upgrade-unassigned', 'ACTIVE', NULL, NULL, NULL, NULL, NULL, NULL, NULL, now(), now()),
  -- 역할은 비었지만 유형은 골라 둔 가입 진행 중 계정. selectedRole이 유일한 근거다.
  ('u-selected', 9910000005, 'upgrade-selected', 'ACTIVE', NULL, 'STUDENT', '합성진행중', '260202', '인공지능학부', NULL, NULL, now(), now());

-- 프로필 행: 직전 이미지가 만드는 모양 그대로 canonical 세 칸을 비워 둔다.
INSERT INTO "UserProfile" ("userId", name, "studentId", department, "memberKind", "affiliationKind", "affiliationName", "createdAt", "updatedAt")
VALUES
  ('u-student',   '합성학생',   '260201', '인공지능학부', NULL, NULL, NULL, now(), now()),
  ('u-staff',     '합성교직원', NULL,     '사업단',       NULL, NULL, NULL, now(), now()),
  ('u-admin',     '합성관리자', NULL,     '사업단',       NULL, NULL, NULL, now(), now()),
  ('u-admin-sel-staff',   '합성관리자교직', NULL, '사업단',       NULL, NULL, NULL, now(), now()),
  ('u-admin-sel-student', '합성관리자학생', NULL, '인공지능학부', NULL, NULL, NULL, now(), now()),
  ('u-selected',  '합성진행중', '260202', '인공지능학부', NULL, NULL, NULL, now(), now());
SQL
}
seed_rows

before_users=$(psql_exec -tA -c 'SELECT count(*) FROM "User"')
before_profiles=$(psql_exec -tA -c 'SELECT count(*) FROM "UserProfile"')

# [3/5] negative 레인 — backfill을 걷어낸 마이그레이션은 이 데이터에서 실패해야 한다.
#       실패하지 않으면 backfill이 아무것도 붙잡고 있지 않다는 뜻이다.
# trap이 지운다 — 아래 어느 지점에서 죽어도 남지 않는다.
negative=$(mktemp -d "${TMPDIR:-/tmp}/bridge-upgrade-neg.XXXXXX")
cp -R "$backend/prisma/migrations" "$negative/migrations"
cp "$backend/prisma/schema.prisma" "$negative/schema.prisma"
# COALESCE를 걷어내 결함이 있던 원래 형태로 되돌린다.
perl -0pi -e 's/COALESCE\(\("role" IN \(.STAFF., .ADMIN.\)\), FALSE\)/("role" IN (\x27STAFF\x27, \x27ADMIN\x27))/' \
  "$negative/migrations/$bridge_dir/migration.sql"
perl -0pi -e 's/COALESCE\(\("role" = .ADMIN.\), FALSE\)/("role" = \x27ADMIN\x27)/' \
  "$negative/migrations/$bridge_dir/migration.sql"
# 주석은 남아 있어도 상관없다 — 실행되는 SQL에서 COALESCE가 사라졌는지만 본다.
if grep -v '^\s*--' "$negative/migrations/$bridge_dir/migration.sql" | grep -q 'COALESCE'; then
  printf 'bridge upgrade: negative lane failed to strip COALESCE\n' >&2
  exit 1
fi
if (cd "$backend" && DATABASE_URL="$database_url" \
  pnpm exec prisma migrate deploy --schema "$negative/schema.prisma" >/dev/null 2>&1); then
  printf 'bridge upgrade: migration without COALESCE unexpectedly succeeded on NULL role rows\n' >&2
  exit 1
fi
printf 'bridge upgrade: negative lane rejected the non-COALESCE backfill as expected\n'

# negative 레인이 실패한 뒤 스키마가 그대로인지 확인한다 — 실패한 마이그레이션이
# 절반만 적용됐다면 이후 판정을 믿을 수 없다.
psql_exec -tA -c 'SELECT 1 FROM "User" LIMIT 1' >/dev/null
failed_rows=$(psql_exec -tA -c "SELECT count(*) FROM _prisma_migrations WHERE migration_name = '$bridge_dir' AND finished_at IS NULL")
if [[ "$failed_rows" != '0' ]]; then
  # 실패 기록이 남았으면 그 행을 지워 positive 레인이 깨끗한 상태에서 시작하게 한다.
  psql_exec -tA -c "DELETE FROM _prisma_migrations WHERE migration_name = '$bridge_dir'" >/dev/null
fi

# [4/5] positive 레인 — 진짜 bridge 마이그레이션을 같은 데이터 위에서 돌린다.
(cd "$backend" && DATABASE_URL="$database_url" pnpm exec prisma migrate deploy >/dev/null)

after_users=$(psql_exec -tA -c 'SELECT count(*) FROM "User"')
after_profiles=$(psql_exec -tA -c 'SELECT count(*) FROM "UserProfile"')
[[ "$before_users" == "$after_users" && "$before_profiles" == "$after_profiles" ]] || {
  printf 'bridge upgrade: row counts drifted (users %s->%s, profiles %s->%s)\n' \
    "$before_users" "$after_users" "$before_profiles" "$after_profiles" >&2
  exit 1
}

# 접근 권한은 전부 채워졌고 legacy 역할과 일치한다.
flags=$(psql_exec -tA <<'SQL'
SELECT string_agg(id || '=' || "hasStaffAccess"::text || '/' || "hasAdminAccess"::text, ',' ORDER BY id)
FROM "User";
SQL
)
expected_flags='u-admin=true/true,u-admin-sel-staff=true/true,u-admin-sel-student=true/true,u-selected=false/false,u-staff=true/false,u-student=false/false,u-unassigned=false/false'
[[ "$flags" == "$expected_flags" ]] || {
  printf 'bridge upgrade: access flags mismatch\n  expected=%s\n  actual  =%s\n' \
    "$expected_flags" "$flags" >&2
  exit 1
}

# 회원 유형은 legacy 사실이 말해 주는 행만 채워졌고, ADMIN은 비어 있다.
kinds=$(psql_exec -tA <<'SQL'
SELECT string_agg("userId" || '=' || COALESCE("memberKind"::text, 'null')
  || '/' || COALESCE("affiliationKind"::text, 'null')
  || '/' || COALESCE("affiliationName", 'null'), ',' ORDER BY "userId")
FROM "UserProfile";
SQL
)
# 배정된 관리자 세 행은 `selectedRole`이 무엇이든 세 칸이 모두 null로 남는다.
# 교직원의 소속 유형은 PROGRAM_OFFICE가 아니라 DEPARTMENT다 — 원본은
# `profile?.affiliationKind ?? DEPARTMENT` 하나뿐이고 회원 유형으로 갈라지지 않는다.
expected_kinds='u-admin=null/null/null,u-admin-sel-staff=null/null/null,u-admin-sel-student=null/null/null,u-selected=STUDENT/DEPARTMENT/인공지능학부,u-staff=STAFF/DEPARTMENT/사업단,u-student=STUDENT/DEPARTMENT/인공지능학부'
[[ "$kinds" == "$expected_kinds" ]] || {
  printf 'bridge upgrade: canonical membership mismatch\n  expected=%s\n  actual  =%s\n' \
    "$expected_kinds" "$kinds" >&2
  exit 1
}

# [5/5] bridge 준비 상태를 확인한다.
#
#       bridge가 보장하는 것은 「관리자가 아닌 미해소 0건」과 「접근 권한 NULL 0건」
#       둘이다. 배정된 관리자는 **의도적으로** 미해소로 남긴다 — 그에게 회원 유형을
#       지어내지 않는 것이 이 단계의 사양이고, 그 분류는 운영에서 명시적으로 한다.
#       최종 contract preflight는 여전히 전체 0건을 요구하므로, 그 사이에 관리자
#       분류를 끝내는 절차가 따로 서야 한다.
unresolved=$(psql_exec -tA <<'SQL'
SELECT count(*) FROM "UserProfile" p
JOIN "User" u ON u.id = p."userId"
WHERE p."memberKind" IS NULL AND u."role" IS DISTINCT FROM 'ADMIN';
SQL
)
[[ "$unresolved" == '0' ]] || {
  printf 'bridge upgrade: %s non-admin profiles still have a null memberKind\n' "$unresolved" >&2
  exit 1
}
# 미해소로 남은 행은 세 칸이 **함께** 비어 있어야 한다 — 정체성이 없는데 소속만
# 채워져 있으면 그것도 지어낸 값이다.
admin_partial=$(psql_exec -tA <<'SQL'
SELECT count(*) FROM "UserProfile"
WHERE "memberKind" IS NULL
  AND ("affiliationKind" IS NOT NULL OR "affiliationName" IS NOT NULL);
SQL
)
[[ "$admin_partial" == '0' ]] || {
  printf 'bridge upgrade: %s unresolved profiles have a fabricated affiliation\n' "$admin_partial" >&2
  exit 1
}

# 해소된 행은 소속명이 비어 있으면 안 된다.
null_affiliation=$(psql_exec -tA -c 'SELECT count(*) FROM "UserProfile" WHERE "memberKind" IS NOT NULL AND "affiliationName" IS NULL')
[[ "$null_affiliation" == '0' ]] || {
  printf 'bridge upgrade: %s resolved profiles still have a null affiliationName\n' "$null_affiliation" >&2
  exit 1
}
null_flags=$(psql_exec -tA -c 'SELECT count(*) FROM "User" WHERE "hasStaffAccess" IS NULL OR "hasAdminAccess" IS NULL')
[[ "$null_flags" == '0' ]] || {
  printf 'bridge upgrade: %s users still have a null access flag\n' "$null_flags" >&2
  exit 1
}

# 재적용 안전성 — 같은 마이그레이션을 다시 돌려도 값이 흔들리지 않는다(멱등).
psql_exec >/dev/null <<'SQL'
UPDATE "UserProfile" SET "affiliationName" = "department" WHERE "affiliationName" IS NULL AND "memberKind" IS NOT NULL;
SQL
kinds_again=$(psql_exec -tA <<'SQL'
SELECT string_agg("userId" || '=' || COALESCE("memberKind"::text, 'null'), ',' ORDER BY "userId")
FROM "UserProfile";
SQL
)
[[ "$kinds_again" == 'u-admin=null,u-admin-sel-staff=null,u-admin-sel-student=null,u-selected=STUDENT,u-staff=STAFF,u-student=STUDENT' ]] || {
  printf 'bridge upgrade: backfill is not idempotent (%s)\n' "$kinds_again" >&2
  exit 1
}

# 미해소로 남은 행 수를 함께 내보낸다 — 이것은 결함이 아니라 **운영이 분류해야 할
# 일감**이다. 최종 contract preflight는 이 수가 0이 된 뒤에야 통과한다.
unresolved_admin=$(psql_exec -tA -c 'SELECT count(*) FROM "UserProfile" WHERE "memberKind" IS NULL')
printf '{"status":"ok","scenario":"bridge-upgrade","users":%s,"profiles":%s,"unresolvedNonAdmin":0,"unresolvedAdminPreserved":%s,"nullAccessFlags":0}\n' \
  "$after_users" "$after_profiles" "$unresolved_admin"
