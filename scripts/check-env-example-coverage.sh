#!/usr/bin/env bash
set -euo pipefail

compose_file=${1:-compose.yml}
env_example=${2:-.env.example}

[[ -f "$compose_file" ]] || { printf 'env example contract: file not found: %s\n' "$compose_file" >&2; exit 1; }
[[ -f "$env_example" ]] || { printf 'env example contract: file not found: %s\n' "$env_example" >&2; exit 1; }

required_keys=()
while IFS= read -r line; do
  if [[ "$line" =~ \$\{([A-Za-z_][A-Za-z0-9_]*):\? ]]; then
    required_keys+=("${BASH_REMATCH[1]}")
  fi
done <"$compose_file"

for key in "${required_keys[@]}"; do
  if ! grep -Eq "^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=" "$env_example"; then
    printf 'env example contract: required key missing: %s\n' "$key" >&2
    exit 1
  fi
done

if ! grep -Eq '^[[:space:]]*AUTH_INITIAL_ROLES:[[:space:]]*\$\{AUTH_INITIAL_ROLES:' "$compose_file"; then
  echo 'env example contract: backend environment must explicitly map AUTH_INITIAL_ROLES.' >&2
  exit 1
fi

echo 'env example contract: ok (all required Compose keys are documented and AUTH_INITIAL_ROLES is mapped)'
