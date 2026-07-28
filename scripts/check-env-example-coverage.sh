#!/usr/bin/env bash
# env 계약 양방향 검사.
# (a) compose.yml 의 ${VAR:?} 필수 키가 .env.example 에 문서화돼 있는지
# (b) apps/*/src 비테스트 코드가 읽는 키가 .env.example 또는 compose.yml 에 있는지
# (c) 합성 env 로 docker compose config 가 통과하는지 (docker 없으면 skip)
set -euo pipefail

compose_file=${1:-compose.yml}
env_example=${2:-.env.example}
# 세 번째 인자는 선택: 코드 스캔 루트(테스트 fixture 용). 기본은 저장소 루트.
scan_root=${3:-}

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/.." && pwd)

if [[ -z "$scan_root" ]]; then
  scan_root=$repo_root
fi

[[ -f "$compose_file" ]] || {
  printf 'env example contract: file not found: %s\n' "$compose_file" >&2
  exit 1
}
[[ -f "$env_example" ]] || {
  printf 'env example contract: file not found: %s\n' "$env_example" >&2
  exit 1
}

# 코드가 읽지만 배포 계약(.env.example / compose.yml)에 두지 않는 키.
# NODE_ENV: 런타임·컨테이너 이미지가 주입하는 내장값.
# OSS_HUB_INTEGRATION_RUNNER: 통합 테스트 runner sentinel. 배포 경로에서 쓰지 않는다.
# DIGEST_FORCE_TO: 마감 알림 CLI 로컬 강제 수신자. 관리 전용.
# IMAGE_TAG: CI·로컬 빌드가 주입. compose 이미지 참조에만 쓰이며 .env.example 계약 밖이다.
is_allowlisted() {
  case "$1" in
    NODE_ENV | OSS_HUB_INTEGRATION_RUNNER | DIGEST_FORCE_TO | IMAGE_TAG) return 0 ;;
    *) return 1 ;;
  esac
}

key_in_env_example() {
  local key=$1
  grep -Eq "^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=" "$env_example"
}

# compose 가 컨테이너에 매핑하거나 치환하는 모든 ${VAR} 키 (?: 와 :- 모두).
compose_mentions_key() {
  local key=$1
  grep -Eq "\\$\\{${key}(:|\\})" "$compose_file"
}

# --- (a) compose ${VAR:?} → .env.example ---
required_keys=()
while IFS= read -r line; do
  if [[ "$line" =~ \$\{([A-Za-z_][A-Za-z0-9_]*):\? ]]; then
    required_keys+=("${BASH_REMATCH[1]}")
  fi
done <"$compose_file"

# 중복 제거(순서 유지)
unique_required=()
for key in "${required_keys[@]}"; do
  already=
  for seen in "${unique_required[@]+"${unique_required[@]}"}"; do
    if [[ "$seen" == "$key" ]]; then
      already=1
      break
    fi
  done
  if [[ -z "$already" ]]; then
    unique_required+=("$key")
  fi
done
required_keys=("${unique_required[@]+"${unique_required[@]}"}")

for key in "${required_keys[@]+"${required_keys[@]}"}"; do
  # IMAGE_TAG 는 빌드 주입값 — .env.example 문서화 대상이 아니다.
  if is_allowlisted "$key"; then
    continue
  fi
  if ! key_in_env_example "$key"; then
    printf 'env example contract: required key missing: %s\n' "$key" >&2
    exit 1
  fi
done

if ! grep -Eq '^[[:space:]]*AUTH_INITIAL_ROLES:[[:space:]]*\$\{AUTH_INITIAL_ROLES:' "$compose_file"; then
  echo 'env example contract: backend environment must explicitly map AUTH_INITIAL_ROLES.' >&2
  exit 1
fi

# --- (b) 코드 process.env.X / env.X → 계약 ---
code_keys_file=$(mktemp "${TMPDIR:-/tmp}/env-code-keys.XXXXXX")
synthetic_env=
cleanup() {
  rm -f "$code_keys_file"
  if [[ -n "${synthetic_env}" ]]; then
    rm -f "$synthetic_env"
  fi
}
trap cleanup EXIT

: >"$code_keys_file"

scan_dirs=()
if [[ -d "$scan_root/apps/backend/src" ]]; then
  scan_dirs+=("$scan_root/apps/backend/src")
fi
if [[ -d "$scan_root/apps/frontend/src" ]]; then
  scan_dirs+=("$scan_root/apps/frontend/src")
fi

# 경로에 공백이 있어도 깨지지 않도록 NUL 구분 find | xargs -0 를 쓴다.
if ((${#scan_dirs[@]} > 0)); then
  {
    # process.env.KEY
    find "${scan_dirs[@]}" -type f \( \
      -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.mjs' -o -name '*.cjs' \
      \) \
      ! -name '*.spec.ts' ! -name '*.spec.tsx' ! -name '*.spec.js' \
      ! -name '*.test.ts' ! -name '*.test.tsx' ! -name '*.test.js' \
      ! -name '*.test.mjs' ! -name '*.test.cjs' \
      ! -path '*/node_modules/*' \
      -print0 2>/dev/null \
      | xargs -0 grep -hEo 'process\.env\.[A-Za-z_][A-Za-z0-9_]*' 2>/dev/null \
      | sed 's/^process\.env\.//' || true

    # env.KEY (NodeJS.ProcessEnv 파라미터). process.env 와 구분.
    find "${scan_dirs[@]}" -type f \( \
      -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.mjs' -o -name '*.cjs' \
      \) \
      ! -name '*.spec.ts' ! -name '*.spec.tsx' ! -name '*.spec.js' \
      ! -name '*.test.ts' ! -name '*.test.tsx' ! -name '*.test.js' \
      ! -name '*.test.mjs' ! -name '*.test.cjs' \
      ! -path '*/node_modules/*' \
      -print0 2>/dev/null \
      | xargs -0 grep -hEo '(^|[^A-Za-z0-9_.])env\.[A-Za-z_][A-Za-z0-9_]*' 2>/dev/null \
      | sed -E 's/.*env\.//' || true

    # environmentValue('KEY') / booleanEnvironmentValue('KEY') — 인자 줄바꿈 허용
    find "${scan_dirs[@]}" -type f \( \
      -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.mjs' -o -name '*.cjs' \
      \) \
      ! -name '*.spec.ts' ! -name '*.spec.tsx' ! -name '*.spec.js' \
      ! -name '*.test.ts' ! -name '*.test.tsx' ! -name '*.test.js' \
      ! -name '*.test.mjs' ! -name '*.test.cjs' \
      ! -path '*/node_modules/*' \
      -print0 2>/dev/null \
      | xargs -0 grep -hE 'environmentValue\(|booleanEnvironmentValue\(' -A2 2>/dev/null \
      | grep -Eo "['\"][A-Za-z_][A-Za-z0-9_]*['\"]" \
      | sed -E "s/['\"]//g" || true

    # smoke CLI 등 *_ENV = 'KEY' 상수
    find "${scan_dirs[@]}" -type f \( \
      -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.mjs' -o -name '*.cjs' \
      \) \
      ! -name '*.spec.ts' ! -name '*.spec.tsx' ! -name '*.spec.js' \
      ! -name '*.test.ts' ! -name '*.test.tsx' ! -name '*.test.js' \
      ! -name '*.test.mjs' ! -name '*.test.cjs' \
      ! -path '*/node_modules/*' \
      -print0 2>/dev/null \
      | xargs -0 grep -hEo "[A-Za-z_][A-Za-z0-9_]*_ENV[[:space:]]*=[[:space:]]*['\"][A-Z][A-Z0-9_]+['\"]" 2>/dev/null \
      | sed -E "s/.*=[[:space:]]*['\"]//;s/['\"].*//" || true

    # CollectionAppConfig.envNames 및 유사 config 리터럴.
    # error code(GITHUB_OPERATIONS_UPSTREAM 등)는 APP_/OAUTH_/S3_/CLEANUP_ 접두 필터로 제외.
    find "${scan_dirs[@]}" -type f \( \
      -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.mjs' -o -name '*.cjs' \
      \) \
      ! -name '*.spec.ts' ! -name '*.spec.tsx' ! -name '*.spec.js' \
      ! -name '*.test.ts' ! -name '*.test.tsx' ! -name '*.test.js' \
      ! -name '*.test.mjs' ! -name '*.test.cjs' \
      ! -path '*/node_modules/*' \
      -print0 2>/dev/null \
      | xargs -0 grep -hEo "['\"]GITHUB_[A-Z0-9_]+['\"]|['\"]SUBMISSION_FILE_[A-Z0-9_]+['\"]" 2>/dev/null \
      | sed -E "s/['\"]//g" \
      | grep -E '^(GITHUB_(APP_ORG|COLLECTION_APP_[A-Z0-9_]+|OPERATIONS_APP_[A-Z0-9_]+|OAUTH_[A-Z0-9_]+)|SUBMISSION_FILE_S3_(ENDPOINT|REGION|BUCKET|ACCESS_KEY_ID|SECRET_ACCESS_KEY|FORCE_PATH_STYLE))$' || true
  } | sort -u >"$code_keys_file"

  while IFS= read -r key; do
    [[ -n "$key" ]] || continue
    # environmentValue 주변 문자열 true/false 등 소문자는 env 키가 아니다.
    if [[ ! "$key" =~ ^[A-Z][A-Z0-9_]*$ ]]; then
      continue
    fi
    if is_allowlisted "$key"; then
      continue
    fi
    if key_in_env_example "$key"; then
      continue
    fi
    if compose_mentions_key "$key"; then
      continue
    fi
    printf 'env example contract: code reads undeclared key: %s\n' "$key" >&2
    exit 1
  done <"$code_keys_file"
fi

# --- (c) 합성 env + docker compose config ---
if ! command -v docker >/dev/null 2>&1; then
  echo 'env example contract: docker not found; skipping compose config validation'
else
  synthetic_env=$(mktemp "${TMPDIR:-/tmp}/env-synthetic.XXXXXX")
  : >"$synthetic_env"

  for key in "${required_keys[@]+"${required_keys[@]}"}"; do
    # 시크릿처럼 보이지 않게 synthetic- 접두사. 값은 비어 있지 않다.
    if ! grep -Eq "^${key}=" "$synthetic_env"; then
      printf '%s=synthetic-%s\n' "$key" "$key" >>"$synthetic_env"
    fi
  done

  # compose 파일 경로는 docker 가 CWD 기준으로 volume 등을 해석하므로
  # compose 가 있는 디렉터리에서 실행한다.
  compose_dir=$(cd "$(dirname "$compose_file")" && pwd)
  compose_base=$(basename "$compose_file")
  if ! (
    cd "$compose_dir"
    docker compose --env-file "$synthetic_env" -f "$compose_base" config --quiet
  ); then
    printf 'env example contract: docker compose config failed with synthetic env\n' >&2
    exit 1
  fi
fi

echo 'env example contract: ok (compose keys documented, code keys covered, AUTH_INITIAL_ROLES mapped)'
