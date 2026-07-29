#!/usr/bin/env bash
# env 계약 삼중 불변식 검사.
# (a) compose.yml 의 ${VAR:?} 필수 키가 .env.example 에 문서화돼 있는지
# (b) apps/*/src 비테스트 코드가 읽는 키가
#     (b1) .env.example 에 선언되고
#     (b2) 소유 서비스(backend|frontend)의 environment 에 명시 매핑되는지
#     — (b1)과 (b2)는 독립이다. 문서만 있고 매핑이 없으면 실패한다.
# (c) 합성 env 로 docker compose config 가 통과하는지 (docker 없으면 skip)
#
# 지원하는 코드 접근 형태(이 밖·해석 불가 동적 접근은 실패):
#   - process.env.KEY
#   - process.env['KEY'] / process.env["KEY"]
#   - const { KEY, ... } = process.env
#   - env.KEY  (NodeJS.ProcessEnv 파라미터)
#   - environmentValue('KEY') / booleanEnvironmentValue('KEY')
#   - NAME_ENV = 'KEY' 상수
#   - 'GITHUB_*' / 'SUBMISSION_FILE_*' config 리터럴(접두 필터)
#   - 승인 helper 본문의 process.env[name] (environmentValue 정의)
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

# --- 예외(검사 단계·소유 경로별). 키 이름 전역 면제는 쓰지 않는다. ---

# (a) compose ${:?} → .env.example 단계에서만 건너뛸 키.
# 현재 없음: IMAGE_TAG 는 로컬 placeholder 로 .env.example 에 둔다.
is_compose_required_doc_exempt() {
  case "$1" in
    *) return 1 ;;
  esac
}

# 코드 소비 키의 .env.example 선언 면제(경로 조건 포함).
# NODE_ENV: Dockerfile·compose.local.yml 이 주입. 계약 문서 대상 아님.
# DIGEST_FORCE_TO: notifications/cli 로컬 강제 수신자만.
# OSS_HUB_INTEGRATION_RUNNER: integration 테스트 runner sentinel 만.
is_declaration_exempt() {
  local key=$1 rel_path=$2
  case "$key" in
    NODE_ENV)
      return 0
      ;;
    DIGEST_FORCE_TO)
      [[ "$rel_path" == *"/notifications/cli/"* ]] && return 0
      return 1
      ;;
    OSS_HUB_INTEGRATION_RUNNER)
      [[ "$rel_path" == *"/integration/"* || "$rel_path" == *integration* ]] && return 0
      return 1
      ;;
    *)
      return 1
      ;;
  esac
}

# 코드 소비 키의 소유 서비스 environment 매핑 면제.
# CLI·이미지·런타임 내장값은 compose 서비스 environment 에 넣지 않는다.
is_service_mapping_exempt() {
  local key=$1 owner=$2 rel_path=$3
  case "$key" in
    NODE_ENV)
      # apps/*/Dockerfile · compose.local.yml 소유
      return 0
      ;;
    IMAGE_TAG)
      # compose image: 치환 전용. 서비스 environment 매핑 대상 아님.
      return 0
      ;;
    DIGEST_FORCE_TO)
      # 마감 알림 CLI 로컬 강제 수신자. 컨테이너 기본 경로에서 안 쓴다.
      [[ "$rel_path" == *"/notifications/cli/"* ]] && return 0
      return 1
      ;;
    OSS_HUB_INTEGRATION_RUNNER)
      # 통합 테스트 runner 가 주입. 배포 compose 에 없음.
      [[ "$rel_path" == *"/integration/"* || "$rel_path" == *integration* ]] && return 0
      return 1
      ;;
    SUBMISSION_FILE_CLEANUP_MAINTENANCE_ENABLED | SUBMISSION_FILE_CLEANUP_OPERATOR_ID)
      # 제출 파일 cleanup 유지보수 CLI 전용.
      [[ "$rel_path" == *"/submissions/cli/"* ]] && return 0
      return 1
      ;;
    GITHUB_COLLECTION_APP_SMOKE_PUBLIC_ALIASES | GITHUB_COLLECTION_APP_SMOKE_PRIVATE_ALIAS)
      # Collection App live smoke CLI 전용.
      [[ "$rel_path" == *"/collection/cli/"* ]] && return 0
      return 1
      ;;
    *)
      return 1
      ;;
  esac
}

key_in_env_example() {
  local key=$1
  grep -Eq "^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=" "$env_example"
}

# services.<service>.environment 블록에 KEY: ${KEY...} 또는 KEY: 형태가 있는지.
# compose 파일 아무 위치의 ${KEY} 치환만으로는 충족하지 않는다.
service_environment_maps_key() {
  local service=$1 key=$2
  local in_service=0 in_env=0
  local line

  while IFS= read -r line || [[ -n "$line" ]]; do
    # 서비스 헤더 (indent 2)
    if [[ "$line" =~ ^\ \ ([A-Za-z0-9_-]+):[[:space:]]*$ ]]; then
      if [[ "${BASH_REMATCH[1]}" == "$service" ]]; then
        in_service=1
        in_env=0
      else
        in_service=0
        in_env=0
      fi
      continue
    fi
    # volumes: 등 탑레벨 키로 서비스 영역 종료
    if [[ "$line" =~ ^[A-Za-z0-9_-]+: ]]; then
      in_service=0
      in_env=0
      continue
    fi
    if ((in_service == 0)); then
      continue
    fi
    # 서비스 직하위 키 (indent 4)
    if [[ "$line" =~ ^\ \ \ \ ([A-Za-z0-9_-]+): ]]; then
      if [[ "${BASH_REMATCH[1]}" == "environment" ]]; then
        in_env=1
      else
        in_env=0
      fi
      continue
    fi
    if ((in_env == 0)); then
      continue
    fi
    # environment 항목 (indent 6+)
    if [[ "$line" =~ ^[[:space:]]+(${key}):[[:space:]]* ]]; then
      return 0
    fi
  done <"$compose_file"
  return 1
}

# 소스 파일 목록 (NUL 구분). 테스트 파일 제외.
list_scan_files() {
  local dir=$1
  find "$dir" -type f \( \
    -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.mjs' -o -name '*.cjs' \
    \) \
    ! -name '*.spec.ts' ! -name '*.spec.tsx' ! -name '*.spec.js' \
    ! -name '*.test.ts' ! -name '*.test.tsx' ! -name '*.test.js' \
    ! -name '*.test.mjs' ! -name '*.test.cjs' \
    ! -path '*/node_modules/*' \
    -print0 2>/dev/null
}

# 한 파일에서 지원 형태로 읽히는 KEY 를 한 줄에 하나씩 stdout.
# 해석 불가 동적 접근이 있으면 stderr 메시지 후 return 2.
extract_keys_from_file() {
  local file=$1
  local content
  content=$(cat "$file")

  # 승인 helper 본문 여부: environmentValue/booleanEnvironmentValue 정의가 있으면
  # process.env[name] 형태의 파라미터 간접 접근을 허용한다.
  local has_env_helper=0
  if grep -Eq 'function[[:space:]]+(environmentValue|booleanEnvironmentValue)[[:space:]]*\(' "$file" \
    || grep -Eq '(environmentValue|booleanEnvironmentValue)[[:space:]]*=[[:space:]]*function' "$file" \
    || grep -Eq '(environmentValue|booleanEnvironmentValue)[[:space:]]*\([^)]*\)[[:space:]]*\{' "$file" \
    || grep -Eq 'const[[:space:]]+(environmentValue|booleanEnvironmentValue)[[:space:]]*=' "$file"; then
    has_env_helper=1
  fi

  # 해석 불가 동적 process.env[expr]
  local dyn_line
  while IFS= read -r dyn_line; do
    [[ -n "$dyn_line" ]] || continue
    # 문자열 리터럴 접근은 OK
    if [[ "$dyn_line" =~ process\.env\[[[:space:]]*[\'\"][A-Za-z_][A-Za-z0-9_]*[\'\"][[:space:]]*\] ]]; then
      continue
    fi
    # 승인 helper 의 process.env[name] (식별자 name 등)
    if ((has_env_helper)) && [[ "$dyn_line" =~ process\.env\[[[:space:]]*[A-Za-z_][A-Za-z0-9_]*[[:space:]]*\] ]]; then
      continue
    fi
    printf 'env example contract: unsupported dynamic process.env access in %s: %s\n' \
      "$file" "$dyn_line" >&2
    return 2
  done < <(grep -E 'process\.env\[' "$file" || true)

  # process.env.KEY
  printf '%s' "$content" | grep -Eo 'process\.env\.[A-Za-z_][A-Za-z0-9_]*' \
    | sed 's/^process\.env\.//' || true

  # process.env['KEY'] / process.env["KEY"]
  printf '%s' "$content" | grep -Eo 'process\.env\[[[:space:]]*['\''"][A-Za-z_][A-Za-z0-9_]*['\''"][[:space:]]*\]' \
    | sed -E 's/.*['\''"]([A-Za-z_][A-Za-z0-9_]*)['\''"].*/\1/' || true

  # const { A, B: c, D = 'x' } = process.env
  local destr
  while IFS= read -r destr; do
    [[ -n "$destr" ]] || continue
    # Destructuring 내부 토큰에서 식별자만 (alias 왼쪽, default 왼쪽)
    printf '%s' "$destr" | grep -Eo '[A-Za-z_][A-Za-z0-9_]*' || true
  done < <(printf '%s' "$content" | grep -Eo '\{[^}]+\}[[:space:]]*=[[:space:]]*process\.env' | sed -E 's/\{([^}]+)\}.*/\1/' || true)

  # env.KEY (파라미터). process.env 와 구분 — 선행이 식별자/점이면 제외는 정규식으로 처리.
  printf '%s' "$content" | grep -Eo '(^|[^A-Za-z0-9_.])env\.[A-Za-z_][A-Za-z0-9_]*' \
    | sed -E 's/.*env\.//' || true

  # environmentValue('KEY') / booleanEnvironmentValue('KEY') — 인자 줄바꿈 허용
  printf '%s' "$content" | grep -E 'environmentValue\(|booleanEnvironmentValue\(' -A2 \
    | grep -Eo "['\"][A-Za-z_][A-Za-z0-9_]*['\"]" \
    | sed -E "s/['\"]//g" || true

  # smoke CLI 등 *_ENV = 'KEY' 상수
  printf '%s' "$content" | grep -Eo "[A-Za-z_][A-Za-z0-9_]*_ENV[[:space:]]*=[[:space:]]*['\"][A-Z][A-Z0-9_]+['\"]" \
    | sed -E "s/.*=[[:space:]]*['\"]//;s/['\"].*//" || true

  # CollectionAppConfig.envNames 및 유사 config 리터럴.
  # error code(GITHUB_OPERATIONS_UPSTREAM 등)는 APP_/OAUTH_/S3_ 접두 필터로 제외.
  printf '%s' "$content" | grep -Eo "['\"]GITHUB_[A-Z0-9_]+['\"]|['\"]SUBMISSION_FILE_[A-Z0-9_]+['\"]" \
    | sed -E "s/['\"]//g" \
    | grep -E '^(GITHUB_(APP_ORG|COLLECTION_APP_[A-Z0-9_]+|OPERATIONS_APP_[A-Z0-9_]+|OAUTH_[A-Z0-9_]+)|SUBMISSION_FILE_S3_(ENDPOINT|REGION|BUCKET|ACCESS_KEY_ID|SECRET_ACCESS_KEY|FORCE_PATH_STYLE)|SUBMISSION_FILE_CLEANUP_[A-Z0-9_]+)$' || true
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
  if is_compose_required_doc_exempt "$key"; then
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

# --- (b) 코드 → 선언 + 소유 서비스 매핑 ---
code_hits_file=$(mktemp "${TMPDIR:-/tmp}/env-code-hits.XXXXXX")
synthetic_env=
cleanup() {
  rm -f "$code_hits_file"
  if [[ -n "${synthetic_env}" ]]; then
    rm -f "$synthetic_env"
  fi
}
trap cleanup EXIT

: >"$code_hits_file"

scan_owner_dir() {
  local owner=$1 dir=$2
  local file rel key
  [[ -d "$dir" ]] || return 0

  while IFS= read -r -d '' file; do
    rel=${file#"$scan_root/"}
    local extracted rc=0
    extracted=$(extract_keys_from_file "$file") || rc=$?
    if ((rc == 2)); then
      exit 1
    fi
    if ((rc != 0)); then
      printf 'env example contract: failed to scan %s\n' "$file" >&2
      exit 1
    fi
    while IFS= read -r key; do
      [[ -n "$key" ]] || continue
      # environmentValue 주변 문자열 true/false 등 소문자는 env 키가 아니다.
      if [[ ! "$key" =~ ^[A-Z][A-Z0-9_]*$ ]]; then
        continue
      fi
      printf '%s\t%s\t%s\n' "$key" "$owner" "$rel"
    done <<<"$extracted"
  done < <(list_scan_files "$dir")
}

if [[ -d "$scan_root/apps/backend/src" ]]; then
  scan_owner_dir backend "$scan_root/apps/backend/src" >>"$code_hits_file"
fi
if [[ -d "$scan_root/apps/frontend/src" ]]; then
  scan_owner_dir frontend "$scan_root/apps/frontend/src" >>"$code_hits_file"
fi

if [[ -s "$code_hits_file" ]]; then
  # 키+소유자 단위로 묶되, 면제 경로 판정을 위해 모든 경로를 본다.
  while IFS= read -r key; do
    [[ -n "$key" ]] || continue

    # 이 키의 모든 hit
    owners=()
    paths=()
    while IFS=$'\t' read -r h_key h_owner h_path; do
      [[ "$h_key" == "$key" ]] || continue
      owners+=("$h_owner")
      paths+=("$h_path")
    done <"$code_hits_file"

    # 소유자별 대표 경로(면제 불가면 매핑 검사에 사용)
    for owner in backend frontend; do
      owner_paths=()
      for i in "${!owners[@]}"; do
        if [[ "${owners[$i]}" == "$owner" ]]; then
          owner_paths+=("${paths[$i]}")
        fi
      done
      ((${#owner_paths[@]} > 0)) || continue

      # 모든 경로가 선언 면제면 선언 검사 skip
      all_decl_exempt=1
      for p in "${owner_paths[@]}"; do
        if ! is_declaration_exempt "$key" "$p"; then
          all_decl_exempt=0
          break
        fi
      done
      if ((all_decl_exempt == 0)); then
        if ! key_in_env_example "$key"; then
          printf 'env example contract: code reads undeclared key: %s (%s)\n' "$key" "$owner" >&2
          exit 1
        fi
      fi

      # 모든 경로가 매핑 면제면 서비스 매핑 skip
      all_map_exempt=1
      sample_path=${owner_paths[0]}
      for p in "${owner_paths[@]}"; do
        if ! is_service_mapping_exempt "$key" "$owner" "$p"; then
          all_map_exempt=0
          sample_path=$p
          break
        fi
      done
      if ((all_map_exempt == 0)); then
        if ! service_environment_maps_key "$owner" "$key"; then
          printf 'env example contract: code key not mapped in %s service environment: %s (from %s)\n' \
            "$owner" "$key" "$sample_path" >&2
          exit 1
        fi
      fi
    done
  done < <(cut -f1 "$code_hits_file" | sort -u)
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

echo 'env example contract: ok (compose keys documented, code keys declared and service-mapped, AUTH_INITIAL_ROLES mapped)'
