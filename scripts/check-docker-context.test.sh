#!/usr/bin/env bash
set -euo pipefail

# check-docker-context.sh의 합성 fixture 회귀 테스트 (Issue #44).
# 실제 시크릿·실데이터 없이 공격 시나리오를 fixture로 고정한다.

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
checker="$repo_root/scripts/check-docker-context.sh"
fixture_dir=$(mktemp -d "${TMPDIR:-/tmp}/docker-context-contract.XXXXXX")
trap 'rm -rf "$fixture_dir"' EXIT

passed=0
failed=0

expect_pass() {
  local name=$1
  local context=$2

  if "$checker" "$context" >/dev/null 2>&1; then
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  else
    printf 'not ok - %s (성공해야 하지만 실패)\n' "$name" >&2
    failed=$((failed + 1))
  fi
}

expect_fail() {
  local name=$1
  local context=$2

  if "$checker" "$context" >/dev/null 2>&1; then
    printf 'not ok - %s (실패해야 하지만 성공)\n' "$name" >&2
    failed=$((failed + 1))
  else
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  fi
}

# 실제 repo 파일로 합성 context를 구성한다. 실데이터·시크릿 없음.
make_context() {
  local name=$1
  local context="$fixture_dir/$name"

  mkdir -p "$context/apps/backend" "$context/apps/frontend"
  cp "$repo_root/.dockerignore" "$context/.dockerignore"
  cp "$repo_root/apps/backend/Dockerfile" "$context/apps/backend/Dockerfile"
  cp "$repo_root/apps/frontend/Dockerfile" "$context/apps/frontend/Dockerfile"
  printf '%s' "$context"
}

remove_rule() {
  local context=$1
  local rule=$2

  grep -Fxv "$rule" "$context/.dockerignore" >"$context/.dockerignore.tmp"
  mv "$context/.dockerignore.tmp" "$context/.dockerignore"
}

ctx=$(make_context valid)
expect_pass '실제 repo 구성 그대로' "$ctx"

ctx=$(make_context missing-dockerignore)
rm "$ctx/.dockerignore"
expect_fail 'root .dockerignore 부재' "$ctx"

ctx=$(make_context missing-env-rule)
remove_rule "$ctx" '**/.[eE][nN][vV]'
expect_fail 'env 대소문자 deny 규칙 제거' "$ctx"

ctx=$(make_context missing-env-suffix-rule)
remove_rule "$ctx" '**/*.[eE][nN][vV]'
expect_fail 'env 접미사 deny 규칙 제거' "$ctx"

ctx=$(make_context missing-node-modules-rule)
remove_rule "$ctx" '**/node_modules'
expect_fail 'node_modules deny 규칙 제거' "$ctx"

ctx=$(make_context missing-key-rule)
remove_rule "$ctx" '**/*.pem'
expect_fail '개인키 deny 규칙 제거' "$ctx"

ctx=$(make_context missing-db-rule)
remove_rule "$ctx" '**/*.sqlite'
expect_fail '로컬 DB deny 규칙 제거' "$ctx"

ctx=$(make_context missing-env-example-reinclude)
remove_rule "$ctx" '!.env.example'
expect_fail '.env.example 재포함 제거' "$ctx"

ctx=$(make_context unexpected-reinclude)
printf '%s\n' '!.env' >>"$ctx/.dockerignore"
expect_fail '허용되지 않은 재포함 규칙 추가' "$ctx"

ctx=$(make_context broad-copy)
printf '%s\n' 'COPY . .' >>"$ctx/apps/backend/Dockerfile"
expect_fail 'context root 전체 COPY' "$ctx"

ctx=$(make_context broad-copy-dot-slash)
printf '%s\n' 'COPY ./ /workspace' >>"$ctx/apps/frontend/Dockerfile"
expect_fail './ 전체 COPY' "$ctx"

ctx=$(make_context broad-copy-parent)
printf '%s\n' 'COPY ../secrets /tmp/secrets' >>"$ctx/apps/backend/Dockerfile"
expect_fail '상위 경로 COPY' "$ctx"

ctx=$(make_context flagged-broad-copy)
printf '%s\n' 'COPY --chown=node:node . /app' >>"$ctx/apps/backend/Dockerfile"
expect_fail 'flag 붙은 전체 COPY' "$ctx"

ctx=$(make_context continued-broad-copy)
printf 'COPY \\\n. .\n' >>"$ctx/apps/backend/Dockerfile"
expect_fail '줄 연속으로 숨긴 전체 COPY' "$ctx"

ctx=$(make_context add-instruction)
printf '%s\n' 'ADD context.tar /tmp/' >>"$ctx/apps/frontend/Dockerfile"
expect_fail 'ADD instruction 사용' "$ctx"

ctx=$(make_context exec-form-copy)
printf '%s\n' 'COPY [".", "/app"]' >>"$ctx/apps/backend/Dockerfile"
expect_fail 'exec form COPY로 우회' "$ctx"

ctx=$(make_context glob-copy)
printf '%s\n' 'COPY * /app/' >>"$ctx/apps/frontend/Dockerfile"
expect_fail 'glob(*) 소스 COPY' "$ctx"

ctx=$(make_context multi-source-broad-dot)
printf '%s\n' 'COPY package.json . /app/' >>"$ctx/apps/backend/Dockerfile"
expect_fail '다중 source 중 후속 . 우회' "$ctx"

ctx=$(make_context multi-source-broad-parent)
printf '%s\n' 'COPY package.json ../secret /app/' >>"$ctx/apps/backend/Dockerfile"
expect_fail '다중 source 중 후속 상위 경로 우회' "$ctx"

ctx=$(make_context multi-source-broad-glob)
printf '%s\n' 'COPY package.json * /app/' >>"$ctx/apps/frontend/Dockerfile"
expect_fail '다중 source 중 후속 glob 우회' "$ctx"

ctx=$(make_context malformed-copy)
printf '%s\n' 'COPY package.json' >>"$ctx/apps/backend/Dockerfile"
expect_fail 'source·destination 미달 COPY (fail-closed)' "$ctx"

ctx=$(make_context root-equivalent-dot-slash-dot)
printf '%s\n' 'COPY ./. /app' >>"$ctx/apps/backend/Dockerfile"
expect_fail '루트 동치 표기 ./. 우회' "$ctx"

ctx=$(make_context dot-slash-glob)
printf '%s\n' 'COPY ./* /app' >>"$ctx/apps/frontend/Dockerfile"
expect_fail './ 접두 glob 우회' "$ctx"

ctx=$(make_context absolute-root)
printf '%s\n' 'COPY / /app' >>"$ctx/apps/backend/Dockerfile"
expect_fail '절대경로 / 우회' "$ctx"

ctx=$(make_context single-char-glob)
printf '%s\n' 'COPY ? /app' >>"$ctx/apps/frontend/Dockerfile"
expect_fail '단일문자 wildcard ? 우회' "$ctx"

ctx=$(make_context mid-path-traversal)
printf '%s\n' 'COPY apps/backend/../../secret /app' >>"$ctx/apps/backend/Dockerfile"
expect_fail '경로 중간 .. 우회' "$ctx"

ctx=$(make_context env-expansion-source)
printf '%s\n' 'COPY $CONTEXT_SOURCE /app' >>"$ctx/apps/backend/Dockerfile"
expect_fail '환경변수 확장 source 우회' "$ctx"

ctx=$(make_context env-expansion-braced)
printf '%s\n' 'COPY ${CONTEXT_SOURCE} /app' >>"$ctx/apps/frontend/Dockerfile"
expect_fail '중괄호 환경변수 확장 source 우회' "$ctx"

ctx=$(make_context commented-broad-copy)
printf '%s\n' '# COPY . .' >>"$ctx/apps/backend/Dockerfile"
expect_pass '주석뿐인 전체 COPY' "$ctx"

ctx=$(make_context scoped-copy)
printf '%s\n' 'COPY apps/backend/prisma ./prisma-extra' >>"$ctx/apps/backend/Dockerfile"
expect_pass '명시 경로 COPY 추가' "$ctx"

ctx=$(make_context multi-source-scoped-copy)
printf '%s\n' 'COPY package.json pnpm-lock.yaml ./meta/' >>"$ctx/apps/backend/Dockerfile"
expect_pass '다중 명시 source COPY (destination ./ 허용)' "$ctx"

ctx=$(make_context stage-copy-root)
printf '%s\n' 'COPY --from=builder . /app' >>"$ctx/apps/backend/Dockerfile"
expect_pass 'stage 간 복사는 context 아님 (--from)' "$ctx"

ctx=$(make_context no-dockerfiles)
rm "$ctx/apps/backend/Dockerfile" "$ctx/apps/frontend/Dockerfile"
expect_fail 'Dockerfile 전부 부재 (fail-closed)' "$ctx"

printf '%s passed, %s failed\n' "$passed" "$failed"
((failed == 0))
