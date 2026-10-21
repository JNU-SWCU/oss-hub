#!/usr/bin/env bash

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
db guard: 자세한 절차는 scripts/dev.sh와 compose.dev.yml를 따릅니다.
GUIDE
  exit 1
fi

expected_port="${POSTGRES_PORT:-5432}"
expected_database="${POSTGRES_DB:-oss_hub}"

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
    const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
    const port = url.port === "" ? "5432" : url.port;
    console.log(["OK", url.hostname, port, database].join("\t"));
  '
) || fail 'DATABASE_URL 파싱에 실패했습니다(node 실행 오류).'

case "$parsed" in
  PARSE_ERROR) fail 'DATABASE_URL이 올바른 URL 형식이 아닙니다.' ;;
  SCHEME_ERROR) fail 'DATABASE_URL의 스킴이 postgresql:// 또는 postgres:// 가 아닙니다.' ;;
esac

IFS=$'\t' read -r _ actual_host actual_port actual_database <<<"$parsed"

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
