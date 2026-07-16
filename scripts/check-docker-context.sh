#!/usr/bin/env bash
set -euo pipefail

# Docker build context 계약 검사 (Issue #44).
# 실제 image build나 Docker daemon 없이 결정론적으로 검증한다:
#   1) root .dockerignore가 존재하고 필수 deny 규칙을 전부 유지한다
#   2) 재포함(!) 규칙은 정확한 소문자 .env.example 한 줄만 허용한다
#   3) apps/*/Dockerfile은 ADD와 broad COPY(context root 전체 복사)를 쓰지 않는다
# 위반 시 라벨·줄번호만 출력하고(내용 미출력) exit 1. 도구 오류는 exit 2.

context_root=${1:-.}

if [[ ! -d "$context_root" ]]; then
  echo "docker-context contract: context root not found: $context_root" >&2
  exit 2
fi

dockerignore="$context_root/.dockerignore"
violations=0

if [[ ! -f "$dockerignore" ]]; then
  echo "docker-context contract: root .dockerignore missing" >&2
  exit 1
fi

# .dockerignore의 char class 패턴(예: .[eE][nN][vV])은 대소문자 변형을 한 줄로 커버한다.
required_rules=(
  '.git'
  '**/node_modules'
  '**/dist'
  '**/.next'
  '**/build'
  '**/coverage'
  '**/.[eE][nN][vV]'
  '**/.[eE][nN][vV].*'
  '**/*.[eE][nN][vV]'
  '**/*.pem'
  '**/*.key'
  '**/id_rsa*'
  '**/id_ed25519*'
  '**/*.sqlite'
  '**/*.sqlite3'
  '**/*.db'
)

for rule in "${required_rules[@]}"; do
  if ! grep -Fxq "$rule" "$dockerignore"; then
    echo "docker-context contract: .dockerignore missing required rule: $rule" >&2
    violations=$((violations + 1))
  fi
done

if ! grep -Fxq '!.env.example' "$dockerignore"; then
  echo "docker-context contract: .dockerignore must re-include exactly '!.env.example'" >&2
  violations=$((violations + 1))
fi

unexpected_reinclude_lines=$(awk '/^[[:space:]]*!/ && $0 != "!.env.example" {print NR}' "$dockerignore")
if [[ -n "$unexpected_reinclude_lines" ]]; then
  for lineno in $unexpected_reinclude_lines; do
    echo "docker-context contract: unexpected re-include rule at .dockerignore line $lineno (allowed: !.env.example)" >&2
    violations=$((violations + 1))
  done
fi

dockerfiles=$(find "$context_root/apps" -mindepth 2 -maxdepth 2 -name Dockerfile -type f 2>/dev/null | sort)
if [[ -z "$dockerfiles" ]]; then
  echo "docker-context contract: no apps/*/Dockerfile found (fail-closed)" >&2
  exit 1
fi

dockerfile_count=0
scan_file=$(mktemp "${TMPDIR:-/tmp}/docker-context-scan.XXXXXX")
trap 'rm -f "$scan_file"' EXIT

while IFS= read -r dockerfile; do
  dockerfile_count=$((dockerfile_count + 1))
  rel_path=${dockerfile#"$context_root"/}

  # full-line 주석을 제외하고, backslash 줄 연속을 한 줄로 합쳐 우회를 막는다.
  awk '
    /^[[:space:]]*#/ { next }
    {
      line=$0
      if (continued != "") line=continued " " line
      if (line ~ /\\[[:space:]]*$/) {
        sub(/\\[[:space:]]*$/, "", line)
        continued=line
        next
      }
      print line
      continued=""
    }
    END {
      if (continued != "") print continued
    }
  ' "$dockerfile" >"$scan_file"

  add_lines=$(grep -En '^[[:space:]]*[Aa][Dd][Dd]([[:space:]]|\[)' "$scan_file" | cut -d: -f1 || true)
  if [[ -n "$add_lines" ]]; then
    for lineno in $add_lines; do
      echo "docker-context contract: ADD instruction prohibited in $rel_path (scan line $lineno) — use COPY with explicit paths" >&2
      violations=$((violations + 1))
    done
  fi

  # exec(JSON) form COPY는 아래 shell form 검사를 우회하므로 전면 금지한다.
  exec_copy_lines=$(grep -En '^[[:space:]]*[Cc][Oo][Pp][Yy][[:space:]]*\[' "$scan_file" | cut -d: -f1 || true)
  if [[ -n "$exec_copy_lines" ]]; then
    for lineno in $exec_copy_lines; do
      echo "docker-context contract: exec-form COPY prohibited in $rel_path (scan line $lineno) — use shell form with explicit paths" >&2
      violations=$((violations + 1))
    done
  fi

  # 소스가 . / ./ / ..으로 시작하거나 glob(*)이면 context root 전체·비명시 복사로 본다.
  broad_copy_lines=$(grep -En '^[[:space:]]*[Cc][Oo][Pp][Yy][[:space:]]+(--[^[:space:]]+[[:space:]]+)*(\.|\./|\.\.[^[:space:]]*|\*[^[:space:]]*)([[:space:]]|$)' "$scan_file" | cut -d: -f1 || true)
  if [[ -n "$broad_copy_lines" ]]; then
    for lineno in $broad_copy_lines; do
      echo "docker-context contract: broad COPY of context root prohibited in $rel_path (scan line $lineno) — copy explicit paths only" >&2
      violations=$((violations + 1))
    done
  fi
done <<<"$dockerfiles"

if [[ "$violations" -gt 0 ]]; then
  echo "docker-context contract: $violations violation(s) found" >&2
  exit 1
fi

echo "docker-context contract: ok (dockerignore rules verified, $dockerfile_count Dockerfile(s) scanned, no image build executed)"
