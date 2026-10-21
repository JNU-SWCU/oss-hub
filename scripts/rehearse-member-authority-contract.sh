#!/usr/bin/env bash
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

staged=$(mktemp -d "${TMPDIR:-/tmp}/contract-staged.XXXXXX")
cp -R "$backend/prisma/migrations" "$staged/migrations"
rm -rf "$staged/migrations/$contract_dir"
cp "$backend/prisma/schema.prisma" "$staged/schema.prisma"
(cd "$backend" && DATABASE_URL="$database_url" \
  pnpm exec prisma migrate deploy --schema "$staged/schema.prisma" >/dev/null)

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

  backup=$(mktemp -d "${TMPDIR:-/tmp}/contract-backup.XXXXXX")
  docker exec -e PGPASSWORD="$password" "$container" \
    pg_dump -U migration -d contract_rehearsal --format=custom \
    >"$backup/pre-contract.dump"
  [[ -s "$backup/pre-contract.dump" ]] || {
    printf 'contract: pre-contract backup is empty\n' >&2
    exit 1
  }

  apply_contract

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
  if psql_exec >/dev/null 2>&1 <<'SQL'
UPDATE "UserProfile" SET "affiliationName" = '다른 소속'
WHERE "userId" = 'fixture:member-authority:user:student:001';
SQL
  then
    printf 'contract: department/affiliationName CHECK did not fire\n' >&2
    exit 1
  fi
  if psql_exec >/dev/null 2>&1 <<'SQL'
UPDATE "UserProfile" SET "studentId" = '260099'
WHERE "memberKind" = 'STAFF';
SQL
  then
    printf 'contract: studentId/memberKind CHECK did not fire\n' >&2
    exit 1
  fi

  if psql_exec >/dev/null 2>&1 <<'SQL'
SELECT "role", "selectedRole" FROM "User" LIMIT 1;
SQL
  then
    printf 'contract: previous image query shape still resolves — rollback boundary is broken\n' >&2
    exit 1
  fi

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

psql_exec >/dev/null <<'SQL'
UPDATE "UserProfile" SET "memberKind" = NULL, "affiliationKind" = NULL, "affiliationName" = NULL
WHERE "userId" = 'fixture:member-authority:user:admin:001';
SQL
assert_preflight_aborted 'an unresolved member kind on an assigned admin'

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

psql_exec >/dev/null <<'SQL'
UPDATE "UserProfile" SET "studentId" = '710003'
WHERE "userId" = 'fixture:member-authority:user:student:003';
CREATE UNIQUE INDEX "UserProfile_studentId_key" ON "UserProfile"("studentId");
SQL

psql_exec >/dev/null <<'SQL'
UPDATE "User" SET role = 'STAFF'
WHERE id = 'fixture:member-authority:user:student:001';
SQL
assert_preflight_aborted 'a v0.6.95-era legacy role that contradicts canonical facts'
psql_exec >/dev/null <<'SQL'
UPDATE "User" SET role = 'STUDENT'
WHERE id = 'fixture:member-authority:user:student:001';
SQL

psql_exec >/dev/null <<'SQL'
UPDATE "_prisma_migrations" SET "finished_at" = NULL
WHERE "migration_name" = '20260823000000_bridge_member_authority';
SQL
assert_preflight_aborted 'a drifted (unfinished) migration ledger row'

printf '{"status":"ok","scenario":"contract-negative","lanes":4}\n'
