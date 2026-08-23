#!/usr/bin/env bash
set -euo pipefail

scenario=${1:-}
if [[ $# -ne 1 ]] ||
  [[ $scenario != 'expand' && $scenario != 'contract' && $scenario != 'contract-negative' ]]; then
  printf 'Usage: scripts/rehearse-member-authority-migrations.sh expand|contract|contract-negative\n' >&2
  exit 2
fi

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
schema="$repo_root/apps/backend/prisma/schema.prisma"
expand_migration="$repo_root/apps/backend/prisma/migrations/20260821000000_add_member_authority_schema_expand/migration.sql"
contract_migration="$repo_root/apps/backend/prisma/migrations/20260824000000_contract_member_authority/migration.sql"

# 계약 레인은 정적 계약을 먼저 통과시킨 뒤에야 컨테이너를 띄운다 — 검사기가
# 잡을 수 있는 결함에 대해 30초짜리 Docker 리허설을 낭비하지 않는다.
if [[ $scenario == 'contract' || $scenario == 'contract-negative' ]]; then
  node "$repo_root/scripts/member-authority-contract-contract.mjs" \
    "$schema" "$contract_migration"
  exec bash "$repo_root/scripts/rehearse-member-authority-contract.sh" "$scenario"
fi

migration="$expand_migration"
node "$repo_root/scripts/member-authority-expand-contract.mjs" "$schema" "$migration"

legacy_sha=08419aec35492abd3a416795f091997dfbe1f712
project_name="oss-hub-member-expand-$(date +%s)-$$-$RANDOM"
fixture_root=$(mktemp -d "${TMPDIR:-/tmp}/member-expand.XXXXXX")
compose_file="$fixture_root/compose.yml"
legacy_source="$fixture_root/legacy"
current_image="${project_name}-current"
legacy_image="${project_name}-legacy"
mkdir -p "$legacy_source"

fixture_compose() {
  LEGACY_IMAGE="$legacy_image" FIXTURE_ROOT="$fixture_root" docker compose "$@"
}

cleanup() {
  local status=$?
  trap - EXIT
  local cleanup_status=0
  fixture_compose --profile legacy -p "$project_name" -f "$compose_file" \
    down -v --remove-orphans >/dev/null 2>&1 || cleanup_status=$?
  if ! docker image rm "$current_image" "$legacy_image" >/dev/null 2>&1; then
    cleanup_status=1
  fi
  rm -rf "$fixture_root"
  if [[ $status -eq 0 && $cleanup_status -ne 0 ]]; then
    printf 'Member authority rehearsal: disposable resource cleanup failed.\n' >&2
    status=$cleanup_status
  fi
  exit "$status"
}
trap cleanup EXIT

cat >"$compose_file" <<'YAML'
services:
  fresh-db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: migration
      POSTGRES_PASSWORD: synthetic-expand-password
      POSTGRES_DB: fresh_expand
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U migration -d fresh_expand']
      interval: 1s
      timeout: 3s
      retries: 30
  upgrade-db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: migration
      POSTGRES_PASSWORD: synthetic-expand-password
      POSTGRES_DB: upgrade_expand
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U migration -d upgrade_expand']
      interval: 1s
      timeout: 3s
      retries: 30
  legacy-backend:
    profiles: [legacy]
    image: ${LEGACY_IMAGE}
    depends_on:
      upgrade-db:
        condition: service_healthy
    environment:
      NODE_ENV: test
      DATABASE_URL: postgresql://migration:synthetic-expand-password@upgrade-db:5432/upgrade_expand?schema=public
      SESSION_SECRET: synthetic-session-secret-at-least-thirty-two-characters
      TEAM_JOIN_CODE_SECRET: synthetic-team-join-code-secret-at-least-thirty-two
      FRONTEND_URL: http://localhost:3000
      GITHUB_OAUTH_CLIENT_ID: synthetic-client-id
      GITHUB_OAUTH_CLIENT_SECRET: synthetic-client-secret
      GITHUB_OAUTH_CALLBACK_URL: http://localhost:3000/api/v1/auth/github/callback
      GITHUB_APP_ORG: synthetic-org
      GITHUB_COLLECTION_APP_ID: '1001'
      GITHUB_COLLECTION_APP_PRIVATE_KEY_FILE: /run/fixture/private-key.pem
      GITHUB_OPERATIONS_APP_ID: '1002'
      GITHUB_OPERATIONS_APP_PRIVATE_KEY_FILE: /run/fixture/private-key.pem
      COLLECTION_CRON_EXPRESSION: '0 0 0 1 1 *'
      PORT: '4000'
      SUBMISSION_FILE_S3_ENDPOINT: http://127.0.0.1:1
      SUBMISSION_FILE_S3_REGION: us-east-1
      SUBMISSION_FILE_S3_BUCKET: synthetic-expand-bucket
      SUBMISSION_FILE_S3_ACCESS_KEY_ID: synthetic-expand-access
      SUBMISSION_FILE_S3_SECRET_ACCESS_KEY: synthetic-expand-secret
      SUBMISSION_FILE_S3_FORCE_PATH_STYLE: 'true'
      MAIL_MODE: dry-run
    volumes:
      - ${FIXTURE_ROOT}/private-key.pem:/run/fixture/private-key.pem:ro
    healthcheck:
      test: ['CMD', 'curl', '--fail', '--silent', 'http://localhost:4000/api/v1/health']
      interval: 1s
      timeout: 3s
      retries: 60
YAML

openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 \
  -out "$fixture_root/private-key.pem" >/dev/null 2>&1
chmod 0644 "$fixture_root/private-key.pem"
git -C "$repo_root" archive "$legacy_sha" | tar -x -C "$legacy_source"
docker build --file "$repo_root/apps/backend/Dockerfile" --tag "$current_image" "$repo_root"
docker build --file "$legacy_source/apps/backend/Dockerfile" --tag "$legacy_image" "$legacy_source"
fixture_compose -p "$project_name" -f "$compose_file" \
  up -d fresh-db upgrade-db --wait --wait-timeout 60

network="${project_name}_default"
fresh_url='postgresql://migration:synthetic-expand-password@fresh-db:5432/fresh_expand?schema=public'
upgrade_url='postgresql://migration:synthetic-expand-password@upgrade-db:5432/upgrade_expand?schema=public'
docker run --rm --network "$network" -e DATABASE_URL="$fresh_url" \
  "$current_image" npx prisma migrate deploy
docker run --rm --network "$network" -e DATABASE_URL="$upgrade_url" \
  "$legacy_image" npx prisma migrate deploy

docker run --rm --network "$network" -e DATABASE_URL="$upgrade_url" "$legacy_image" node -e '
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
prisma.user.create({ data: {
  id: "synthetic-expand-user", githubId: 990000001n, nickname: "synthetic-expand",
  name: "legacy-name", studentId: "123456", department: "legacy-department",
  role: "STUDENT", selectedRole: "STUDENT",
  profile: { create: { name: "profile-name", studentId: "123456", department: "profile-department" } },
} }).then(() => prisma.$disconnect()).catch(async () => { await prisma.$disconnect(); process.exit(1); });
'

docker run --rm --network "$network" -e DATABASE_URL="$upgrade_url" \
  "$current_image" npx prisma migrate deploy
docker run --rm --network "$network" -e DATABASE_URL="$upgrade_url" "$current_image" node -e '
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
Promise.all([
  prisma.user.findUnique({
    where: { id: "synthetic-expand-user" },
    select: { name: true, studentId: true, department: true, role: true, selectedRole: true,
      selectedMemberKind: true, hasStaffAccess: true, hasAdminAccess: true,
      profile: { select: { name: true, studentId: true, department: true, memberKind: true, affiliationKind: true, affiliationName: true } } },
  }),
  prisma.user.count(),
  prisma.userProfile.count(),
]).then(([user, userCount, profileCount]) => {
  // bridge 마이그레이션이 접근 권한 두 칸을 legacy role에서 backfill한 뒤 NOT NULL로 잠근다.
  // STUDENT는 교직원·관리자 접근이 모두 없으므로 두 값이 false다.
  //
  // 정본 프로필 세 칸도 같은 마이그레이션이 채운다. 이 행은 legacy role이
  // STUDENT라 회원 유형이 STUDENT로 해소되고, 소속 유형은 원본 기본값인
  // DEPARTMENT, 소속명은 `department`의 사본이 된다.
  const expected = { name: "legacy-name", studentId: "123456", department: "legacy-department", role: "STUDENT", selectedRole: "STUDENT",
    selectedMemberKind: null, hasStaffAccess: false, hasAdminAccess: false,
    profile: { name: "profile-name", studentId: "123456", department: "profile-department", memberKind: "STUDENT", affiliationKind: "DEPARTMENT", affiliationName: "profile-department" } };
  if (userCount !== 1 || profileCount !== 1 || JSON.stringify(user) !== JSON.stringify(expected)) process.exitCode = 1;
}).finally(() => prisma.$disconnect());
'

fixture_compose --profile legacy -p "$project_name" -f "$compose_file" \
  up -d legacy-backend --wait --wait-timeout 120
fixture_compose --profile legacy -p "$project_name" -f "$compose_file" \
  exec -T legacy-backend curl --fail --silent http://localhost:4000/api/v1/health >/dev/null
fixture_compose --profile legacy -p "$project_name" -f "$compose_file" \
  exec -T legacy-backend curl --fail --silent http://localhost:4000/api/v1/auth/session >/dev/null

printf '{"status":"ok","scenario":"expand"}\n'
