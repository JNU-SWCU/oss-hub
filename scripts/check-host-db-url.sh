#!/usr/bin/env bash
# 호스트 lane(`pnpm dev`) prisma 실행 전 DATABASE_URL 가드.
#
# 왜 필요한가: `pnpm db:reset`은 `prisma migrate reset --force`라 파괴적이다.
# 이전에는 연결 문자열이 package.json에 인라인으로 박혀 있어, compose.dev.yml이
# 허용하는 POSTGRES_PORT·POSTGRES_DB override를 쓰면 `pnpm db:up`은 새 주소로
# 옮겨가고 이 명령만 5432에 남아 **그 자리의 다른 DB를 지웠다**.
#
# 이 스크립트는 호스트 lane의 유일한 env 원본인 `.envrc`의 DATABASE_URL이
# compose.dev.yml이 실제로 publish하는 주소를 가리키는지만 확인한다.
# 값은 어떤 경로에서도 출력하지 않는다 — 키 이름과 불일치 사실만 보고한다.

set -euo pipefail

fail() {
  printf 'db guard: %s\n' "$1" >&2
  exit 1
}

if [ -z "${DATABASE_URL:-}" ]; then
  cat >&2 <<'GUIDE'
db guard: DATABASE_URL이 비어 있어 실행할 수 없습니다.
db guard: 호스트 lane의 env 원본은 .envrc입니다.
db guard:   cp .envrc.example .envrc && direnv allow
db guard: direnv를 쓰지 않으면 현재 쉘에 직접 주입하세요:
db guard:   set -a; . ./.envrc; set +a
db guard: 자세한 절차는 docs/rules/local-dev.md의 "두 실행 경로"를 따릅니다.
GUIDE
  exit 1
fi

# compose.dev.yml의 기본값과 같은 규칙으로 기대 주소를 만든다.
expected_port="${POSTGRES_PORT:-5432}"
expected_database="${POSTGRES_DB:-oss_hub}"

# 파싱은 node에 맡긴다 — 자격증명에 포함된 특수문자를 정규식으로 다루면 오판한다.
# 출력은 검증 결과 3줄뿐이며 URL 자체는 반환하지 않는다.
parsed=$(
  node -e '
    const raw = process.env.DATABASE_URL;
    let url;
    try {
      url = new URL(raw);
    } catch {
      console.log("PARSE_ERROR");
      process.exit(0);
    }
    if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
      console.log("SCHEME_ERROR");
      process.exit(0);
    }
    // pathname은 "/dbname" 형태다. 선행 슬래시만 제거한다.
    const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
    // 포트 생략은 PostgreSQL 기본값 5432을 뜻한다.
    const port = url.port === "" ? "5432" : url.port;
    console.log(["OK", url.hostname, port, database].join("\t"));
  '
) || fail 'DATABASE_URL 파싱에 실패했습니다(node 실행 오류).'

case "$parsed" in
  PARSE_ERROR) fail 'DATABASE_URL이 올바른 URL 형식이 아닙니다.' ;;
  SCHEME_ERROR) fail 'DATABASE_URL의 스킴이 postgresql:// 또는 postgres:// 가 아닙니다.' ;;
esac

IFS=$'\t' read -r _ actual_host actual_port actual_database <<<"$parsed"

# 호스트 lane은 compose.dev.yml이 로컬로 publish한 포트에만 붙는다.
# 원격 주소를 거부해 운영·공유 DB를 파괴적 명령의 사정거리에서 제외한다.
case "$actual_host" in
  localhost | 127.0.0.1 | ::1 | '[::1]') ;;
  *)
    fail "DATABASE_URL의 호스트가 로컬이 아닙니다(host=${actual_host}). 호스트 lane의 db 스크립트는 로컬 전용입니다."
    ;;
esac

if [ "$actual_port" != "$expected_port" ]; then
  fail "DATABASE_URL의 포트와 compose.dev.yml이 publish하는 포트가 다릅니다(DATABASE_URL=${actual_port}, POSTGRES_PORT=${expected_port}). 둘을 일치시키세요."
fi

if [ "$actual_database" != "$expected_database" ]; then
  fail "DATABASE_URL의 데이터베이스와 POSTGRES_DB가 다릅니다(DATABASE_URL=${actual_database}, POSTGRES_DB=${expected_database}). 둘을 일치시키세요."
fi

printf 'db guard: DATABASE_URL 확인 (host=%s port=%s db=%s · 자격증명은 출력하지 않습니다)\n' \
  "$actual_host" "$actual_port" "$actual_database"
