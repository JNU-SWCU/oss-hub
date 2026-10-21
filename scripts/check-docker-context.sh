#!/usr/bin/env bash
set -euo pipefail


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

backend_dockerfile="$context_root/apps/backend/Dockerfile"
if [[ -f "$backend_dockerfile" ]] && ! grep -Fxq 'CMD ["node", "dist/src/main.js"]' "$backend_dockerfile"; then
  echo 'docker-context contract: backend runtime CMD must execute dist/src/main.js' >&2
  violations=$((violations + 1))
fi

dockerfile_count=0
scan_file=$(mktemp "${TMPDIR:-/tmp}/docker-context-scan.XXXXXX")
trap 'rm -f "$scan_file"' EXIT

while IFS= read -r dockerfile; do
  dockerfile_count=$((dockerfile_count + 1))
  rel_path=${dockerfile#"$context_root"/}

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

  exec_copy_lines=$(grep -En '^[[:space:]]*[Cc][Oo][Pp][Yy][[:space:]]*\[' "$scan_file" | cut -d: -f1 || true)
  if [[ -n "$exec_copy_lines" ]]; then
    for lineno in $exec_copy_lines; do
      echo "docker-context contract: exec-form COPY prohibited in $rel_path (scan line $lineno) — use shell form with explicit paths" >&2
      violations=$((violations + 1))
    done
  fi

  broad_copy_report=$(awk -v rel="$rel_path" '
    tolower($1) == "copy" {
      n = 0
      from_stage = 0
      for (i = 2; i <= NF; i++) {
        if (n == 0 && $i ~ /^--/) {
          if (tolower($i) ~ /^--from=/) from_stage = 1
          continue
        }
        tokens[++n] = $i
      }
      if (n < 2) {
        printf "docker-context contract: malformed COPY (source and destination required) in %s (scan line %d)\n", rel, NR
        delete tokens
        next
      }
      if (from_stage) {
        delete tokens
        next
      }
      for (j = 1; j < n; j++) {
        t = tokens[j]
        if (t ~ /\$/) {
          printf "docker-context contract: variable-expansion COPY source prohibited in %s (scan line %d, source position %d) — ARG/ENV 값에 따라 root·glob 동치가 될 수 있으므로 literal 명시 경로만 허용\n", rel, NR, j
          continue
        }
        if (t ~ /[*?\[]/) {
          printf "docker-context contract: wildcard COPY source prohibited in %s (scan line %d, source position %d) — copy explicit paths only\n", rel, NR, j
          continue
        }
        if (t ~ /^\//) {
          printf "docker-context contract: absolute COPY source prohibited in %s (scan line %d, source position %d) — use explicit context-relative paths\n", rel, NR, j
          continue
        }
        m = split(t, seg, "/")
        real = 0
        parent = 0
        for (k = 1; k <= m; k++) {
          s = seg[k]
          if (s == "" || s == ".") continue
          if (s == "..") { parent = 1; break }
          real++
        }
        if (parent) {
          printf "docker-context contract: parent-traversal COPY source prohibited in %s (scan line %d, source position %d)\n", rel, NR, j
        } else if (real == 0) {
          printf "docker-context contract: context-root COPY source prohibited in %s (scan line %d, source position %d) — copy explicit paths only\n", rel, NR, j
        }
      }
      delete tokens
    }
  ' "$scan_file")
  if [[ -n "$broad_copy_report" ]]; then
    while IFS= read -r report_line; do
      echo "$report_line" >&2
      violations=$((violations + 1))
    done <<<"$broad_copy_report"
  fi
done <<<"$dockerfiles"

if [[ "$violations" -gt 0 ]]; then
  echo "docker-context contract: $violations violation(s) found" >&2
  exit 1
fi

echo "docker-context contract: ok (dockerignore/runtime CMD rules verified, $dockerfile_count Dockerfile(s) scanned, no image build executed)"
