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
fixture="$backend/prisma/fixtures/member-authority-contract-62-users.json"
contract_dir='20260824000000_contract_member_authority'

container="oss-hub-contract-$(date +%s)-$$-$RANDOM"
password='synthetic-contract-password'
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

# [1/6] 계약 마이그레이션 **직전**까지 적용한다 — 그 상태가 오늘의 생산 스키마다.
# Prisma는 schema 파일 위치에서 migrations 경로를 파생하므로, 계약 디렉터리를 뺀
# 스테이징 트리에 schema를 함께 두고 그 경로만 쓴다. 프로세스 치환 fallback은
# 항상 실패하고 stderr를 삼켜 진짜 오류를 숨기므로 두지 않는다.
staged=$(mktemp -d "${TMPDIR:-/tmp}/contract-staged.XXXXXX")
cp -R "$backend/prisma/migrations" "$staged/migrations"
rm -rf "$staged/migrations/$contract_dir"
# 직전 이미지의 스키마 모양(계약 이전)을 쓴다 — 계약 스키마로는 계약 이전 DB를
# 만들 수 없다. `migrate deploy`는 SQL만 보므로 schema는 경로 파생에만 쓰인다.
cp "$backend/prisma/schema.prisma" "$staged/schema.prisma"
(cd "$backend" && DATABASE_URL="$database_url" \
  pnpm exec prisma migrate deploy --schema "$staged/schema.prisma" >/dev/null)

# [2/6] 생산 모양 합성 데이터를 심는다. 값은 전부 합성이다.
#
# 62명·4건은 운영 규모의 축소판이 아니라 **정확히 그 분포**다 — 학생·교직원·
# 배정 관리자·미배정 계정·프로필 없는 계정이 모두 들어 있다. 행 수가 아니라
# 그 분포가 preflight를 실제로 통과시키는 근거다.
seed_fixture() {
  node "$repo_root/scripts/member-authority-contract-seed.mjs" "$fixture" \
    | psql_exec >/dev/null
}

apply_contract() {
  (cd "$backend" && DATABASE_URL="$database_url" \
    pnpm exec prisma migrate deploy >/dev/null)
}

user_digest() {
  psql_exec -tA <<'SQL'
SELECT string_agg(id, ',' ORDER BY id) FROM "User";
SQL
}

request_digest() {
  local table=$1
  psql_exec -tA <<SQL
SELECT string_agg(id || ':' || status, ',' ORDER BY id) FROM "$table";
SQL
}

if [[ $scenario == 'contract' ]]; then
  seed_fixture

  users_before=$(psql_exec -tA -c 'SELECT count(*) FROM "User"')
  profiles_before=$(psql_exec -tA -c 'SELECT count(*) FROM "UserProfile"')
  ids_before=$(user_digest)
  requests_before=$(request_digest 'RoleRequest')

  [[ "$users_before" == '62' ]] || {
    printf 'contract: expected 62 seeded users, found %s\n' "$users_before" >&2
    exit 1
  }

  # [3/6] 파괴적 DDL **이전에** 백업을 뜬다. 계약이 잘못되면 되돌릴 유일한 근거다.
  backup=$(mktemp -d "${TMPDIR:-/tmp}/contract-backup.XXXXXX")
  docker exec -e PGPASSWORD="$password" "$container" \
    pg_dump -U migration -d contract_rehearsal --format=custom \
    >"$backup/pre-contract.dump"
  [[ -s "$backup/pre-contract.dump" ]] || {
    printf 'contract: pre-contract backup is empty\n' >&2
    exit 1
  }

  apply_contract

  # [4/6] 행·id·상태가 그대로 이어졌는가. 개명은 데이터를 복사하지 않으므로
  #       62개 사용자 ID와 4건의 요청 id·상태가 **문자 그대로** 같아야 한다.
  users_after=$(psql_exec -tA -c 'SELECT count(*) FROM "User"')
  profiles_after=$(psql_exec -tA -c 'SELECT count(*) FROM "UserProfile"')
  ids_after=$(user_digest)
  requests_after=$(request_digest 'StaffAccessRequest')

  [[ "$users_before" == "$users_after" ]] || {
    printf 'contract: user count drifted %s -> %s\n' "$users_before" "$users_after" >&2
    exit 1
  }
  [[ "$profiles_before" == "$profiles_after" ]] || {
    printf 'contract: profile count drifted %s -> %s\n' "$profiles_before" "$profiles_after" >&2
    exit 1
  }
  [[ "$ids_before" == "$ids_after" ]] || {
    printf 'contract: user ids drifted\n' >&2
    exit 1
  }
  [[ "$requests_before" == "$requests_after" ]] || {
    printf 'contract: request history drifted\n  before=%s\n  after=%s\n' \
      "$requests_before" "$requests_after" >&2
    exit 1
  }

  # 계약된 학생·교직원·관리자·회수 흐름이 각각 살아 있는가.
  # 권한과 정체성은 독립이므로 **학생으로 분류된 관리자**가 반드시 있어야 한다 —
  # ADMIN=>교직원 추론이 어딘가에 남아 있으면 이 수가 0이 된다.
  student_admins=$(psql_exec -tA -c 'SELECT count(*) FROM "User" u JOIN "UserProfile" p ON p."userId" = u."id" WHERE u."hasAdminAccess" AND p."memberKind" = '"'"'STUDENT'"'"'')
  [[ "$student_admins" -gt 0 ]] || {
    printf 'contract: no student-identity admin survived — identity was inferred from authority\n' >&2
    exit 1
  }
  staff_only=$(psql_exec -tA -c 'SELECT count(*) FROM "User" WHERE "hasStaffAccess" AND NOT "hasAdminAccess"')
  [[ "$staff_only" -gt 0 ]] || {
    printf 'contract: no staff-without-admin account survived\n' >&2
    exit 1
  }
  revoked=$(psql_exec -tA -c 'SELECT count(*) FROM "User" WHERE NOT "hasStaffAccess" AND NOT "hasAdminAccess"')
  [[ "$revoked" -gt 0 ]] || {
    printf 'contract: no unprivileged (revoked) account survived\n' >&2
    exit 1
  }

  # [5/6] legacy 칸과 타입이 실제로 사라졌고 CHECK가 살아 있는가.
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
  legacy_table=$(psql_exec -tA -c "SELECT count(*) FROM information_schema.tables WHERE table_name='RoleRequest'")
  [[ "$legacy_table" == '0' ]] || {
    printf 'contract: legacy RoleRequest table survived the rename\n' >&2
    exit 1
  }
  # 소속 사본 불일치는 CHECK가 거부해야 한다.
  if psql_exec >/dev/null 2>&1 <<'SQL'
UPDATE "UserProfile" SET "affiliationName" = '다른 소속'
WHERE "userId" = 'fixture:member-authority:user:student:001';
SQL
  then
    printf 'contract: department/affiliationName CHECK did not fire\n' >&2
    exit 1
  fi
  # STAFF에 학번을 넣는 것도 거부해야 한다.
  if psql_exec >/dev/null 2>&1 <<'SQL'
UPDATE "UserProfile" SET "studentId" = '260099'
WHERE "memberKind" = 'STAFF';
SQL
  then
    printf 'contract: studentId/memberKind CHECK did not fire\n' >&2
    exit 1
  fi

  # [6/6] 직전 이미지(v0.6.95)는 이 스키마 위에서 **거부되어야 한다.**
  #
  # 그 이미지는 `User.role`을 직접 읽는다. 계약 이후 그 컬럼이 없으므로 질의가
  # 실패하는 것이 옳다 — 여기서 성공하면 롤백 경계가 무너진 것이고, 운영에서
  # 옛 이미지가 조용히 깨진 데이터를 쓰게 된다.
  if psql_exec >/dev/null 2>&1 <<'SQL'
SELECT "role", "selectedRole" FROM "User" LIMIT 1;
SQL
  then
    printf 'contract: previous image query shape still resolves — rollback boundary is broken\n' >&2
    exit 1
  fi

  # 백업 복원이 실제로 계약 이전 상태를 되살리는가. 이것이 되돌릴 유일한 경로다.
  psql_exec -q -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' >/dev/null 2>&1
  docker exec -i -e PGPASSWORD="$password" "$container" \
    pg_restore -U migration -d contract_rehearsal --no-owner \
    <"$backup/pre-contract.dump" >/dev/null 2>&1
  restored_users=$(psql_exec -tA -c 'SELECT count(*) FROM "User"')
  restored_ids=$(user_digest)
  restored_requests=$(request_digest 'RoleRequest')
  [[ "$restored_users" == "$users_before" ]] || {
    printf 'contract: restore drifted user count %s -> %s\n' "$users_before" "$restored_users" >&2
    exit 1
  }
  [[ "$restored_ids" == "$ids_before" ]] || {
    printf 'contract: restore drifted user ids\n' >&2
    exit 1
  }
  [[ "$restored_requests" == "$requests_before" ]] || {
    printf 'contract: restore drifted request history\n' >&2
    exit 1
  }
  restored_legacy=$(psql_exec -tA -c "SELECT count(*) FROM information_schema.columns WHERE table_name='User' AND column_name='role'")
  [[ "$restored_legacy" == '1' ]] || {
    printf 'contract: restore did not bring back the legacy rollback columns\n' >&2
    exit 1
  }

  printf '{"status":"ok","scenario":"contract","users":%s,"profiles":%s,"requests":4,"studentAdmins":%s,"restored":true}\n' \
    "$users_after" "$profiles_after" "$student_admins"
  exit 0
fi

# contract-negative — 어긋난 데이터가 파괴적 DDL 이전에 거부되는지 증명한다.
#
# 매 레인마다 **거부된 뒤에도 legacy 칸과 테이블이 그대로 남아 있는지** 확인한다.
# 그것이 남아 있어야 직전 이미지로 되돌아갈 수 있다. Prisma는 마이그레이션 파일
# 하나를 단일 트랜잭션으로 돌리므로 preflight 실패는 전체를 롤백한다.
assert_preflight_aborted() {
  local reason=$1
  if apply_contract 2>/dev/null; then
    printf 'contract-negative: migration accepted %s\n' "$reason" >&2
    exit 1
  fi
  local survived legacy_table role_type
  survived=$(psql_exec -tA -c "SELECT count(*) FROM information_schema.columns WHERE table_name='User' AND column_name='role'")
  [[ "$survived" == '1' ]] || {
    printf 'contract-negative: User.role was dropped despite the failed preflight (%s)\n' "$reason" >&2
    exit 1
  }
  legacy_table=$(psql_exec -tA -c "SELECT count(*) FROM information_schema.tables WHERE table_name='RoleRequest'")
  [[ "$legacy_table" == '1' ]] || {
    printf 'contract-negative: RoleRequest was renamed despite the failed preflight (%s)\n' "$reason" >&2
    exit 1
  }
  role_type=$(psql_exec -tA -c "SELECT count(*) FROM pg_type WHERE typname='Role'")
  [[ "$role_type" == '1' ]] || {
    printf 'contract-negative: Role enum was dropped despite the failed preflight (%s)\n' "$reason" >&2
    exit 1
  }
}

seed_fixture

# [negative 1/4] 미해결 대상 — 배정된 관리자의 회원 유형이 비어 있다.
# bridge가 의도적으로 남기는 부류이므로, 운영 분류를 건너뛴 배포가 정확히 이 모양이다.
psql_exec >/dev/null <<'SQL'
UPDATE "UserProfile" SET "memberKind" = NULL, "affiliationKind" = NULL, "affiliationName" = NULL
WHERE "userId" = 'fixture:member-authority:user:admin:001';
SQL
assert_preflight_aborted 'an unresolved member kind on an assigned admin'

# [negative 2/4] 학번 중복 — CHECK는 행 단위라 유일성을 볼 수 없어 preflight가 세야 한다.
# 유일 인덱스를 먼저 떨어뜨려야 중복을 심을 수 있다. 복원 누락으로 인덱스가 빠진
# DB가 정확히 이 모양이며, 그때 계약은 중복을 조용히 통과시켜서는 안 된다.
psql_exec >/dev/null <<'SQL'
UPDATE "UserProfile"
SET "memberKind" = 'STUDENT', "affiliationKind" = 'DEPARTMENT',
    "affiliationName" = "department", "studentId" = '710001'
WHERE "userId" = 'fixture:member-authority:user:admin:001';
DROP INDEX IF EXISTS "UserProfile_studentId_key";
UPDATE "UserProfile" SET "studentId" = '710002'
WHERE "userId" = 'fixture:member-authority:user:student:003';
SQL
assert_preflight_aborted 'a duplicated student id'

# 중복을 거둔다. 이후 레인은 다른 게이트를 따로 친다 —
# 한 트랜잭션에 여러 위반을 섞으면 앞의 게이트만 실행되고 뒤는 검증되지 않는다.
psql_exec >/dev/null <<'SQL'
UPDATE "UserProfile" SET "studentId" = '710003'
WHERE "userId" = 'fixture:member-authority:user:student:003';
CREATE UNIQUE INDEX "UserProfile_studentId_key" ON "UserProfile"("studentId");
SQL

# [negative 3/4] v0.6.95 비호환 — 직전 이미지가 쓰던 legacy 사실이 canonical과 어긋난다.
# 그 이미지가 계약 배포 도중 legacy 칸에 쓰기를 되살리면 정확히 이 모양이 된다.
psql_exec >/dev/null <<'SQL'
UPDATE "User" SET role = 'STAFF'
WHERE id = 'fixture:member-authority:user:student:001';
SQL
assert_preflight_aborted 'a v0.6.95-era legacy role that contradicts canonical facts'
psql_exec >/dev/null <<'SQL'
UPDATE "User" SET role = 'STUDENT'
WHERE id = 'fixture:member-authority:user:student:001';
SQL

# [negative 4/4] 마이그레이션 드리프트 — 앞선 마이그레이션이 끝나지 않은 채 남아 있다.
# 그 위에서는 물리 스키마가 어디까지 갔는지 알 수 없어 되돌릴 근거를 특정할 수 없다.
psql_exec >/dev/null <<'SQL'
UPDATE "_prisma_migrations" SET "finished_at" = NULL
WHERE "migration_name" = '20260823000000_bridge_member_authority';
SQL
assert_preflight_aborted 'a drifted (unfinished) migration ledger row'

printf '{"status":"ok","scenario":"contract-negative","lanes":4}\n'
