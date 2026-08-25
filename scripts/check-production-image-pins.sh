#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
label='Production image pin contract'

usage() {
  cat >&2 <<'EOF'
Usage:
  scripts/check-production-image-pins.sh
  scripts/check-production-image-pins.sh COMPOSE_FILE DOCKERFILE...
EOF
  exit 2
}

if [[ $# -eq 0 ]]; then
  compose_file="$repo_root/compose.yml"
  dockerfiles=(
    "$repo_root/apps/backend/Dockerfile"
    "$repo_root/apps/frontend/Dockerfile"
  )
elif [[ $# -ge 2 ]]; then
  compose_file=$1
  shift
  dockerfiles=("$@")
else
  usage
fi

failures=0
external_references=0

report_invalid_reference() {
  local file=$1 line_number=$2 source_kind=$3 reference=$4 reason=$5
  printf '%s: %s:%s: external %s image "%s" %s\n' \
    "$label" "$file" "$line_number" "$source_kind" "$reference" "$reason" >&2
  failures=$((failures + 1))
}

check_external_reference() {
  local file=$1 line_number=$2 source_kind=$3 reference=$4 digest

  reference=${reference%\"}
  reference=${reference#\"}
  reference=${reference%\'}
  reference=${reference#\'}

  if [[ "$reference" == oss-hub-* ]]; then
    return
  fi

  external_references=$((external_references + 1))
  if [[ ! "$reference" =~ ^[^@[:space:]]+:[^@[:space:]]+@sha256:([0-9a-f]{64})$ ]]; then
    report_invalid_reference \
      "$file" "$line_number" "$source_kind" "$reference" \
      'must retain a readable tag and add @sha256:<64 lowercase hex>'
    return
  fi

  digest=${BASH_REMATCH[1]}
  if [[ "$digest" =~ ^0+$ ]]; then
    report_invalid_reference \
      "$file" "$line_number" "$source_kind" "$reference" \
      'uses an all-zero placeholder digest'
  fi
}

if [[ ! -f "$compose_file" ]]; then
  printf '%s: Compose file not found: %s\n' "$label" "$compose_file" >&2
  exit 1
fi

line_number=0
while IFS= read -r line || [[ -n "$line" ]]; do
  line_number=$((line_number + 1))
  if [[ "$line" =~ ^[[:space:]]+image:[[:space:]]*([^[:space:]#]+) ]]; then
    check_external_reference \
      "$compose_file" "$line_number" 'Compose' "${BASH_REMATCH[1]}"
  fi
done <"$compose_file"

for dockerfile in "${dockerfiles[@]}"; do
  if [[ ! -f "$dockerfile" ]]; then
    printf '%s: Dockerfile not found: %s\n' "$label" "$dockerfile" >&2
    failures=$((failures + 1))
    continue
  fi

  stage_aliases=()
  line_number=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line_number=$((line_number + 1))
    if [[ ! "$line" =~ ^[[:space:]]*[Ff][Rr][Oo][Mm][[:space:]]+(.+)$ ]]; then
      continue
    fi

    read -r -a fields <<<"${BASH_REMATCH[1]}"
    field_index=0
    if [[ "${fields[0]}" == --platform=* ]]; then
      field_index=1
    fi
    reference=${fields[$field_index]:-}
    if [[ -z "$reference" ]]; then
      report_invalid_reference \
        "$dockerfile" "$line_number" 'Dockerfile FROM' '<missing>' \
        'does not name an image'
      continue
    fi

    internal_stage=false
    for alias in "${stage_aliases[@]}"; do
      if [[ "$reference" == "$alias" ]]; then
        internal_stage=true
        break
      fi
    done
    if [[ "$reference" != scratch && "$internal_stage" == false ]]; then
      check_external_reference \
        "$dockerfile" "$line_number" 'Dockerfile FROM' "$reference"
    fi

    alias_index=$((field_index + 1))
    if [[ "${fields[$alias_index]:-}" =~ ^[Aa][Ss]$ && -n "${fields[$((alias_index + 1))]:-}" ]]; then
      stage_aliases+=("${fields[$((alias_index + 1))]}")
    fi
  done <"$dockerfile"
done

if ((external_references == 0)); then
  printf '%s: no external production image references found\n' "$label" >&2
  exit 1
fi

if ((failures != 0)); then
  printf '%s: failed (%s invalid external image reference(s))\n' \
    "$label" "$failures" >&2
  exit 1
fi

printf '%s: ok (%s external image reference(s) use tag@sha256 digest pins)\n' \
  "$label" "$external_references"
