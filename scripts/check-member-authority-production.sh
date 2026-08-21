#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: scripts/check-member-authority-production.sh <status|ready-for-cutover> <tag> <sha> <url> <output-json>\n' >&2
  exit 2
}

[[ $# -eq 5 ]] || usage
mode=$1
tag=$2
sha=$3
base_url=${4%/}
output_json=$5

[[ "$mode" == status || "$mode" == ready-for-cutover ]] || usage
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || usage
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || usage
[[ "$base_url" =~ ^https://[^/]+$ ]] || usage
[[ ! -e "$output_json" ]] || {
  printf 'member-authority-production: output already exists\n' >&2
  exit 1
}

env_file=${OSS_HUB_ENV_FILE:-}
if [[ -z "$env_file" || ! -f "$env_file" || ! -r "$env_file" || ! -s "$env_file" ]]; then
  printf 'member-authority-production: production env file is unavailable\n' >&2
  exit 1
fi

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/member-authority-production.XXXXXX")
trap 'rm -rf "$tmp_dir"' EXIT
aggregate_path="$tmp_dir/aggregate.json"
ledger_path="$tmp_dir/ledger.json"
compose=(docker compose --env-file "$env_file")

curl --fail --silent --show-error "$base_url/api/v1/health" >/dev/null

inspect_service() {
  local service=$1
  local expected_image="oss-hub-${service}:${tag}"
  local container_id inspection image_ref version revision image_id state health local_image_id
  container_id=$("${compose[@]}" ps -q "$service")
  [[ -n "$container_id" ]] || return 1
  inspection=$(docker inspect --format '{{.Config.Image}}|{{index .Config.Labels "org.opencontainers.image.version"}}|{{index .Config.Labels "org.opencontainers.image.revision"}}|{{.Image}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container_id")
  IFS='|' read -r image_ref version revision image_id state health <<<"$inspection"
  [[ "$image_ref" == "$expected_image" ]] || return 1
  [[ "$version" == "$tag" ]] || return 1
  [[ "$revision" == "$sha" ]] || return 1
  [[ "$state" == running ]] || return 1
  [[ "$health" == healthy ]] || return 1
  local_image_id=$(docker image inspect --format '{{.Id}}' "$expected_image")
  [[ "$image_id" == "$local_image_id" ]] || return 1
  printf '%s' "$image_id"
}

frontend_image_id=$(inspect_service frontend) || {
  printf 'member-authority-production: frontend image verification failed\n' >&2
  exit 1
}
backend_image_id=$(inspect_service backend) || {
  printf 'member-authority-production: backend image verification failed\n' >&2
  exit 1
}

"${compose[@]}" exec -T backend \
  node scripts/prisma-migration-ledger.mjs prisma/migrations \
  >"$ledger_path"

"${compose[@]}" exec -T backend \
  node dist/prisma/member-authority-backfill.js --status-production --evidence - \
  >"$aggregate_path"

if ! node "$repo_root/scripts/member-authority-production-report.mjs" \
  "$mode" "$tag" "$sha" "$output_json" \
  "$frontend_image_id" "$backend_image_id" "$aggregate_path" "$ledger_path"; then
  printf 'member-authority-production: cutover gate not ready\n' >&2
  exit 1
fi

printf 'member-authority-production: %s ok\n' "$mode"
