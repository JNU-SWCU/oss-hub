#!/usr/bin/env bash
# bridge 정적 계약을 **저장소의 실제 파일**에 대해 실행한다.
#
# 단위 테스트(`member-authority-bridge-contract.test.mjs`)는 검사기가 합성 문자열에
# 대해 올바로 동작하는지를 본다. 그것만으로는 "이 저장소가 규칙을 지킨다"는 것을
# 아무도 확인하지 않는다 — 검사기가 완벽해도 실제 스키마·마이그레이션·소스에 한 번도
# 대보지 않으면 회귀가 그대로 통과한다. 이 스크립트가 그 간극을 메운다.
#
# 대상: 실제 `schema.prisma`, 실제 bridge 마이그레이션 SQL, 그리고
#       `member-authority-bridge-sources.mjs`가 고른 추적 중인 생산 TS 전부.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
schema="$repo_root/apps/backend/prisma/schema.prisma"
migration="$repo_root/apps/backend/prisma/migrations/20260823000000_bridge_member_authority/migration.sql"

for required in "$schema" "$migration"; do
  if [[ ! -f $required ]]; then
    printf 'bridge check: missing required file %s\n' "$required" >&2
    exit 1
  fi
done

# 스캔 대상은 정책 모듈이 정한다 — 여기서 glob을 다시 쓰지 않는다.
mapfile -t sources < <(cd "$repo_root" && node scripts/member-authority-bridge-sources.mjs)
if [[ ${#sources[@]} -eq 0 ]]; then
  printf 'bridge check: source policy selected no files\n' >&2
  exit 1
fi

printf 'bridge check: scanning %d tracked production sources\n' "${#sources[@]}"
(cd "$repo_root" && node scripts/member-authority-bridge-contract.mjs \
  "$schema" "$migration" "${sources[@]}")
