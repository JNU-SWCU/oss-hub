#!/usr/bin/env bash
# bridge 릴리스의 **직전 이미지 호환** 리허설.
#
# 증명하려는 것은 한 문장이다 — bridge 스키마 위에서 **두 이미지가 모두 산다**.
#
#   [previous] v0.6.110 (정확히 197fd717) 이미지가 bridge 스키마에 붙어 부팅하고
#             health와 session 라우트를 missing column/table 오류 없이 응답한다.
#   [bridge]   이번 릴리스 이미지가 같은 스키마 위에서 부팅하고 health·session과
#             인증 가드(비인증 401)를 정본 계약대로 응답한다.
#
# 두 이미지가 같은 DB를 **번갈아** 쓴다는 점이 요점이다. 각자 자기 DB에서만
# 도는 검사는 롤백 가능성을 아무것도 말해 주지 않는다.
#
# 일회용 컨테이너만 쓰고 끝나면 전부 지운다. 개발자 DB에 절대 붙지 않는다.
set -euo pipefail

if [[ $# -ne 0 ]]; then
  printf 'Usage: scripts/rehearse-member-authority-bridge.sh\n' >&2
  exit 2
fi

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

# v0.6.110 = 197fd717833ea2ea5aceab6cf56ba02a57e93085. 태그가 아니라 SHA로 고정한다 —
# 태그는 옮길 수 있고, 이 리허설이 말하는 "직전 이미지"는 정확히 그 커밋이다.
previous_sha=197fd717833ea2ea5aceab6cf56ba02a57e93085
previous_tag=v0.6.110

project_name="oss-hub-bridge-$(date +%s)-$$-$RANDOM"
fixture_root=$(mktemp -d "${TMPDIR:-/tmp}/member-bridge.XXXXXX")
compose_file="$fixture_root/compose.yml"
previous_source="$fixture_root/previous"
bridge_image="${project_name}-bridge"
previous_image="${project_name}-previous"
mkdir -p "$previous_source"

fixture_compose() {
  PREVIOUS_IMAGE="$previous_image" BRIDGE_IMAGE="$bridge_image" \
    FIXTURE_ROOT="$fixture_root" docker compose "$@"
}

cleanup() {
  local status=$?
  trap - EXIT
  local cleanup_status=0
  fixture_compose --profile previous --profile bridge -p "$project_name" -f "$compose_file" \
    down -v --remove-orphans >/dev/null 2>&1 || cleanup_status=$?
  if ! docker image rm "$bridge_image" "$previous_image" >/dev/null 2>&1; then
    cleanup_status=1
  fi
  rm -rf "$fixture_root"
  if [[ $status -eq 0 && $cleanup_status -ne 0 ]]; then
    printf 'Bridge rehearsal: disposable resource cleanup failed.\n' >&2
    status=$cleanup_status
  fi
  exit "$status"
}
trap cleanup EXIT

cat >"$compose_file" <<'YAML'
services:
  bridge-db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: migration
      POSTGRES_PASSWORD: synthetic-bridge-password
      POSTGRES_DB: bridge_rehearsal
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U migration -d bridge_rehearsal']
      interval: 1s
      timeout: 3s
      retries: 30
  previous-backend:
    profiles: [previous]
    image: ${PREVIOUS_IMAGE}
    depends_on:
      bridge-db:
        condition: service_healthy
    environment: &backend_environment
      NODE_ENV: test
      DATABASE_URL: postgresql://migration:synthetic-bridge-password@bridge-db:5432/bridge_rehearsal?schema=public
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
      SUBMISSION_FILE_S3_BUCKET: synthetic-bridge-bucket
      SUBMISSION_FILE_S3_ACCESS_KEY_ID: synthetic-bridge-access
      SUBMISSION_FILE_S3_SECRET_ACCESS_KEY: synthetic-bridge-secret
      SUBMISSION_FILE_S3_FORCE_PATH_STYLE: 'true'
      MAIL_MODE: dry-run
    volumes:
      - ${FIXTURE_ROOT}/private-key.pem:/run/fixture/private-key.pem:ro
    healthcheck:
      test: ['CMD', 'curl', '--fail', '--silent', 'http://localhost:4000/api/v1/health']
      interval: 1s
      timeout: 3s
      retries: 60
  bridge-backend:
    profiles: [bridge]
    image: ${BRIDGE_IMAGE}
    depends_on:
      bridge-db:
        condition: service_healthy
    environment: *backend_environment
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

printf 'bridge rehearsal: previous image = %s (%s)\n' "$previous_tag" "$previous_sha"
git -C "$repo_root" archive "$previous_sha" | tar -x -C "$previous_source"
docker build --file "$repo_root/apps/backend/Dockerfile" --tag "$bridge_image" "$repo_root"
docker build --file "$previous_source/apps/backend/Dockerfile" --tag "$previous_image" "$previous_source"

fixture_compose -p "$project_name" -f "$compose_file" up -d bridge-db --wait --wait-timeout 60

network="${project_name}_default"
bridge_url='postgresql://migration:synthetic-bridge-password@bridge-db:5432/bridge_rehearsal?schema=public'

# [1/5] bridge 이미지가 스키마를 만든다 — 이 릴리스가 실제로 배포할 그 스키마다.
docker run --rm --network "$network" -e DATABASE_URL="$bridge_url" \
  "$bridge_image" npx prisma migrate deploy

# [2/5] 직전 이미지가 **자신의 정확한 AUTH_USER_SELECT 컬럼 집합과 RoleRequest**를
#       그 스키마에서 읽고, 자신의 쓰기 경로대로 행을 만든다. 여기서 컬럼/테이블이
#       하나라도 없으면 이 단계가 그 자리에서 터진다.
docker run --rm --network "$network" -e DATABASE_URL="$bridge_url" "$previous_image" node -e '
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const AUTH_USER_SELECT = {
  id: true, githubId: true, nickname: true, avatarUrl: true, notificationEmail: true,
  accountStatus: true, role: true, selectedRole: true, selectedMemberKind: true,
  hasStaffAccess: true, hasAdminAccess: true,
  name: true, studentId: true, department: true,
  profile: { select: { name: true, studentId: true, department: true,
    memberKind: true, affiliationKind: true, affiliationName: true } },
};
(async () => {
  // 직전 이미지의 가입 경로 그대로 — 접근 권한 두 칸을 생략한다.
  await prisma.user.createMany({ data: {
    id: "bridge-previous-user", githubId: 990100001n, nickname: "bridge-previous",
  }, skipDuplicates: true });
  // 직전 이미지의 프로필 writer 그대로 — canonical 세 칸을 쓰지 않는다.
  await prisma.userProfile.create({ data: {
    userId: "bridge-previous-user", name: "이전이미지", studentId: "260101", department: "이전학과",
  } });
  await prisma.user.update({ where: { id: "bridge-previous-user" },
    data: { role: "STUDENT", selectedRole: "STUDENT", name: "이전이미지", studentId: "260101", department: "이전학과" } });
  // RoleRequest 이력 — 물리 테이블·타입 이름이 그대로여야 한다.
  await prisma.roleRequest.create({ data: {
    id: "bridge-previous-request", userId: "bridge-previous-user", status: "PENDING" } });
  const user = await prisma.user.findUnique({ where: { id: "bridge-previous-user" }, select: AUTH_USER_SELECT });
  if (user === null) { throw new Error("previous image could not read back its own row"); }
  // 직전 이미지가 기대하는 값이 그대로 읽히는가.
  const mismatched = [];
  if (user.role !== "STUDENT") mismatched.push("role");
  if (user.selectedRole !== "STUDENT") mismatched.push("selectedRole");
  if (user.name !== "이전이미지") mismatched.push("name");
  if (user.studentId !== "260101") mismatched.push("studentId");
  if (user.department !== "이전학과") mismatched.push("department");
  // 접근 권한 두 칸은 bridge가 DEFAULT FALSE로 잠갔다 — 신규 계정은 권한 없음이다.
  if (user.hasStaffAccess !== false) mismatched.push("hasStaffAccess");
  if (user.hasAdminAccess !== false) mismatched.push("hasAdminAccess");
  // canonical 프로필 세 칸은 직전 이미지가 쓰지 않으므로 null이어야 한다(nullable 유지 근거).
  if (user.profile.memberKind !== null) mismatched.push("profile.memberKind");
  if (user.profile.affiliationKind !== null) mismatched.push("profile.affiliationKind");
  if (user.profile.affiliationName !== null) mismatched.push("profile.affiliationName");
  if (mismatched.length > 0) { throw new Error("previous image read drift: " + mismatched.join(",")); }
  process.stdout.write("previous image AUTH_USER_SELECT + RoleRequest: ok\n");
})().then(() => prisma.$disconnect()).catch(async (error) => {
  process.stderr.write(String(error && error.message ? error.message : error) + "\n");
  await prisma.$disconnect(); process.exit(1);
});
'

# [3/5] 직전 이미지가 실제로 **부팅**하고 health·session을 응답한다.
fixture_compose --profile previous -p "$project_name" -f "$compose_file" \
  up -d previous-backend --wait --wait-timeout 120
fixture_compose --profile previous -p "$project_name" -f "$compose_file" \
  exec -T previous-backend curl --fail --silent http://localhost:4000/api/v1/health >/dev/null
previous_session_status=$(fixture_compose --profile previous -p "$project_name" -f "$compose_file" \
  exec -T previous-backend curl --silent --output /dev/null --write-out '%{http_code}' \
  http://localhost:4000/api/v1/auth/session)
if [[ $previous_session_status != '200' && $previous_session_status != '401' ]]; then
  printf 'bridge rehearsal: previous image session returned %s\n' "$previous_session_status" >&2
  exit 1
fi
# 부팅과 라우트 처리 중에 missing column/table 오류가 한 줄도 없어야 한다.
previous_logs=$(fixture_compose --profile previous -p "$project_name" -f "$compose_file" \
  logs --no-color previous-backend 2>&1)
if grep -Eq 'does not exist|column .* does not exist|relation .* does not exist|Unknown argument|P1012|P2022' <<<"$previous_logs"; then
  printf 'bridge rehearsal: previous image logged a missing column/table error\n' >&2
  grep -E 'does not exist|Unknown argument|P1012|P2022' <<<"$previous_logs" | head -20 >&2
  exit 1
fi
fixture_compose --profile previous -p "$project_name" -f "$compose_file" \
  stop previous-backend >/dev/null

# [4/5] 같은 스키마 위에서 **이번 릴리스 이미지**가 부팅하고 정본 계약을 응답한다.
fixture_compose --profile bridge -p "$project_name" -f "$compose_file" \
  up -d bridge-backend --wait --wait-timeout 120
fixture_compose --profile bridge -p "$project_name" -f "$compose_file" \
  exec -T bridge-backend curl --fail --silent http://localhost:4000/api/v1/health >/dev/null
bridge_session_status=$(fixture_compose --profile bridge -p "$project_name" -f "$compose_file" \
  exec -T bridge-backend curl --silent --output /dev/null --write-out '%{http_code}' \
  http://localhost:4000/api/v1/auth/session)
if [[ $bridge_session_status != '200' && $bridge_session_status != '401' ]]; then
  printf 'bridge rehearsal: bridge image session returned %s\n' "$bridge_session_status" >&2
  exit 1
fi

# 인증 가드 — 비인증 요청은 보호 라우트에서 401이어야 한다(fail-closed).
# 프로필 조회는 SessionGuard, 관리 목록은 그 위에 관리자 판정까지 얹힌 경로다.
# 둘 다 물어본다 — 하나만 보면 「세션은 막는데 권한은 열려 있다」를 놓친다.
guard_status=$(fixture_compose --profile bridge -p "$project_name" -f "$compose_file" \
  exec -T bridge-backend curl --silent --output /dev/null --write-out '%{http_code}' \
  http://localhost:4000/api/v1/users/me/profile)
if [[ $guard_status != '401' ]]; then
  printf 'bridge rehearsal: unauthenticated profile guard returned %s (expected 401)\n' "$guard_status" >&2
  exit 1
fi
admin_guard_status=$(fixture_compose --profile bridge -p "$project_name" -f "$compose_file" \
  exec -T bridge-backend curl --silent --output /dev/null --write-out '%{http_code}' \
  http://localhost:4000/api/v1/users/access)
if [[ $admin_guard_status != '401' ]]; then
  printf 'bridge rehearsal: unauthenticated admin guard returned %s (expected 401)\n' "$admin_guard_status" >&2
  exit 1
fi

bridge_logs=$(fixture_compose --profile bridge -p "$project_name" -f "$compose_file" \
  logs --no-color bridge-backend 2>&1)
if grep -Eq 'does not exist|Unknown argument|P1012|P2022' <<<"$bridge_logs"; then
  printf 'bridge rehearsal: bridge image logged a missing column/table error\n' >&2
  grep -E 'does not exist|Unknown argument|P1012|P2022' <<<"$bridge_logs" | head -20 >&2
  exit 1
fi

# [5/5] bridge 이미지가 **정본 이름으로** 같은 이력 행을 읽는다 — @@map이 실제로 도는가.
docker run --rm --network "$network" -e DATABASE_URL="$bridge_url" "$bridge_image" node -e '
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  const request = await prisma.staffAccessRequest.findUnique({ where: { id: "bridge-previous-request" } });
  if (request === null || request.status !== "PENDING") {
    throw new Error("bridge image could not read the previous image RoleRequest row through @@map");
  }
  const user = await prisma.user.findUnique({ where: { id: "bridge-previous-user" },
    select: { hasStaffAccess: true, hasAdminAccess: true, profile: { select: { memberKind: true } } } });
  if (user === null || user.hasStaffAccess !== false || user.hasAdminAccess !== false) {
    throw new Error("bridge image saw non fail-closed access flags");
  }
  if (user.profile === null || user.profile.memberKind !== null) {
    throw new Error("bridge image expected an unresolved canonical member kind");
  }
  process.stdout.write("bridge image canonical names over legacy physical schema: ok\n");
})().then(() => prisma.$disconnect()).catch(async (error) => {
  process.stderr.write(String(error && error.message ? error.message : error) + "\n");
  await prisma.$disconnect(); process.exit(1);
});
'

printf '{"status":"ok","scenario":"bridge","previousImage":"%s","previousSha":"%s","previousSession":%s,"bridgeSession":%s,"unauthenticatedProfileGuard":%s,"unauthenticatedAdminGuard":%s}\n' \
  "$previous_tag" "$previous_sha" "$previous_session_status" "$bridge_session_status" \
  "$guard_status" "$admin_guard_status"
