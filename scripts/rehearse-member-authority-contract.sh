#!/usr/bin/env bash
# 계약(contract) 마이그레이션 리허설.
#
# `contract`          — 생산 모양 데이터가 손실 없이 계약 스키마로 넘어가는지 증명한다.
# `contract-negative` — 어긋난 데이터가 **파괴적 DDL 이전에** 거부되는지 증명한다.
#
# 두 시나리오 모두 일회용 PostgreSQL 컨테이너를 직접 소유하고 끝나면 지운다.
# 개발자 DB에 절대 붙지 않는다.
set -euo pipefail

scenario=$1
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
backend="$repo_root/apps/backend"

container="oss-hub-contract-$(date +%s)-$$-$RANDOM"
password='synthetic-contract-password'
port=''
staged=''

cleanup() {
  local status=$?
  trap - EXIT
  docker rm -f "$container" >/dev/null 2>&1 || true
  if [[ -n ${staged:-} ]]; then
    rm -rf -- "$staged"
  fi
  exit "$status"
}
trap cleanup EXIT

docker run -d --name "$container" \
  -e POSTGRES_USER=migration \
  -e POSTGRES_PASSWORD="$password" \
  -e POSTGRES_DB=contract_rehearsal \
  -p 0:5432 postgres:17-alpine >/dev/null
port=$(docker port "$container" 5432/tcp | head -1 | sed 's/.*://')
database_url="postgresql://migration:${password}@127.0.0.1:${port}/contract_rehearsal?schema=public"

for _ in $(seq 1 60); do
  if docker exec "$container" pg_isready -U migration -d contract_rehearsal >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$container" pg_isready -U migration -d contract_rehearsal >/dev/null

psql_exec() {
  docker exec -i -e PGPASSWORD="$password" "$container" \
    psql -v ON_ERROR_STOP=1 -U migration -d contract_rehearsal "$@"
}

# [1/4] 계약 마이그레이션 **직전**까지 적용한다 — 그 상태가 오늘의 생산 스키마다.
contract_dir=$(basename "$(dirname "$backend/prisma/migrations/20260823000000_contract_member_authority/migration.sql")")
staged=$(mktemp -d "${TMPDIR:-/tmp}/contract-staged.XXXXXX")
cp -R "$backend/prisma/migrations" "$staged/migrations"
rm -rf "$staged/migrations/$contract_dir"
(
  cd "$backend"
  DATABASE_URL="$database_url" PRISMA_MIGRATIONS_PATH="$staged/migrations" \
    pnpm exec prisma migrate deploy --schema <(
      sed "s#migrations#migrations#" "$backend/prisma/schema.prisma"
    ) >/dev/null 2>&1
) || {
  # Prisma는 migrations 경로를 schema 파일 위치에서 파생한다 — 스테이징 디렉터리로
  # 통째로 옮겨 적용한다.
  cp "$backend/prisma/schema.prisma" "$staged/schema.prisma"
  (cd "$backend" && DATABASE_URL="$database_url" \
    pnpm exec prisma migrate deploy --schema "$staged/schema.prisma" >/dev/null)
}

# [2/4] 생산 모양 합성 데이터를 심는다. 값은 전부 합성이다.
seed_valid() {
  psql_exec >/dev/null <<'SQL'
INSERT INTO "User" (id, "githubId", login, "accountStatus", "selectedMemberKind", "hasStaffAccess", "hasAdminAccess", "createdAt", "updatedAt")
VALUES
  ('c-student', 9900000001, 'contract-student', 'ACTIVE', 'STUDENT', FALSE, FALSE, now(), now()),
  ('c-staff',   9900000002, 'contract-staff',   'ACTIVE', 'STAFF',   TRUE,  FALSE, now(), now()),
  ('c-admin',   9900000003, 'contract-admin',   'ACTIVE', 'STUDENT', FALSE, TRUE,  now(), now()),
  ('c-legacy',  9900000004, 'contract-legacy',  'ACTIVE', 'STUDENT', FALSE, FALSE, now(), now());

INSERT INTO "UserProfile" ("userId", name, "studentId", department, "memberKind", "affiliationKind", "affiliationName", "createdAt", "updatedAt")
VALUES
  ('c-student', '합성 학생',   '260001',     '인공지능학부', 'STUDENT', 'DEPARTMENT',     '인공지능학부', now(), now()),
  ('c-staff',   '합성 교직원', NULL,         '사업단',       'STAFF',   'PROGRAM_OFFICE', '사업단',       now(), now()),
  ('c-admin',   '합성 관리자', '260002',     '인공지능학부', 'STUDENT', 'DEPARTMENT',     '인공지능학부', now(), now()),
  -- 6~10자리 보존 형식 학번. 계약 CHECK가 이 값을 계속 받아야 한다.
  ('c-legacy',  '합성 편입생', '2600030001', '인공지능학부', 'STUDENT', 'DEPARTMENT',     '인공지능학부', now(), now());

INSERT INTO "RoleRequest" (id, "userId", status, "createdAt", "updatedAt")
VALUES
  ('c-req-approved', 'c-staff',   'APPROVED', now(), now()),
  ('c-req-revoked',  'c-legacy',  'REVOKED',  now(), now());
SQL
}

apply_contract() {
  (cd "$backend" && DATABASE_URL="$database_url" \
    pnpm exec prisma migrate deploy >/dev/null)
}

if [[ $scenario == 'contract' ]]; then
  seed_valid
  before=$(psql_exec -tA -c 'SELECT count(*) FROM "User"')
  requests_before=$(psql_exec -tA <<'SQL'
SELECT string_agg(id || ':' || status, ',' ORDER BY id) FROM "RoleRequest";
SQL
)

  apply_contract

  # [3/4] 행·id·상태가 그대로 이어졌는가.
  after=$(psql_exec -tA -c 'SELECT count(*) FROM "User"')
  requests_after=$(psql_exec -tA <<'SQL'
SELECT string_agg(id || ':' || status, ',' ORDER BY id) FROM "StaffAccessRequest";
SQL
)
  [[ "$before" == "$after" ]] || {
    printf 'contract: user count drifted %s -> %s\n' "$before" "$after" >&2
    exit 1
  }
  [[ "$requests_before" == "$requests_after" ]] || {
    printf 'contract: request history drifted\n  before=%s\n  after=%s\n' \
      "$requests_before" "$requests_after" >&2
    exit 1
  }

  # [4/4] legacy 칸과 타입이 실제로 사라졌고 CHECK가 살아 있는가.
  legacy=$(psql_exec -tA -c "SELECT count(*) FROM information_schema.columns WHERE table_name='User' AND column_name IN ('role','selectedRole','name','studentId','department')")
  [[ "$legacy" == '0' ]] || {
    printf 'contract: %s legacy User columns survived\n' "$legacy" >&2
    exit 1
  }
  role_type=$(psql_exec -tA -c "SELECT count(*) FROM pg_type WHERE typname='Role'")
  [[ "$role_type" == '0' ]] || {
    printf 'contract: Role enum survived\n' >&2
    exit 1
  }
  # 소속 사본 불일치는 CHECK가 거부해야 한다.
  if psql_exec >/dev/null 2>&1 <<'SQL'
UPDATE "UserProfile" SET "affiliationName" = '다른 소속' WHERE "userId" = 'c-student';
SQL
  then
    printf 'contract: department/affiliationName CHECK did not fire\n' >&2
    exit 1
  fi
  # STAFF에 학번을 넣는 것도 거부해야 한다.
  if psql_exec >/dev/null 2>&1 <<'SQL'
UPDATE "UserProfile" SET "studentId" = '260099' WHERE "userId" = 'c-staff';
SQL
  then
    printf 'contract: studentId/memberKind CHECK did not fire\n' >&2
    exit 1
  fi

  printf '{"status":"ok","scenario":"contract","users":%s}\n' "$after"
  exit 0
fi

# contract-negative — 어긋난 데이터가 파괴적 DDL 이전에 거부되는지 증명한다.
seed_valid
psql_exec >/dev/null <<'SQL'
-- 소속 사본이 어긋난 행 하나. preflight [3/7]이 잡아야 한다.
UPDATE "UserProfile" SET "affiliationName" = '어긋난 소속' WHERE "userId" = 'c-student';
SQL

if apply_contract 2>/dev/null; then
  printf 'contract-negative: migration accepted mismatched affiliation data\n' >&2
  exit 1
fi

# 거부된 뒤에도 legacy 칸과 테이블이 **그대로 남아 있어야** 롤백이 가능하다.
survived=$(psql_exec -tA -c "SELECT count(*) FROM information_schema.columns WHERE table_name='User' AND column_name='role'")
[[ "$survived" == '1' ]] || {
  printf 'contract-negative: User.role was dropped despite the failed preflight\n' >&2
  exit 1
}
legacy_table=$(psql_exec -tA -c "SELECT count(*) FROM information_schema.tables WHERE table_name='RoleRequest'")
[[ "$legacy_table" == '1' ]] || {
  printf 'contract-negative: RoleRequest was renamed despite the failed preflight\n' >&2
  exit 1
}

printf '{"status":"ok","scenario":"contract-negative"}\n'
