#!/usr/bin/env bash
# shellcheck source=deploy/jenkins/program-migration/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

backup_dir="${1:-}"
label="${2:-}"
[[ -n "$backup_dir" && -n "$label" && "$#" == 2 ]] || pm_fail 'usage: verify-backup.sh <backup-dir> <label>'
receipt="$backup_dir/$label.receipt"
dump="$backup_dir/$label.sql"
[[ -f "$receipt" && ! -L "$receipt" ]] || pm_fail "backup receipt missing: $label"
[[ -f "$dump" && ! -L "$dump" ]] || pm_fail "backup dump missing: $label"

receipt_value() {
  local value
  value="$(sed -n "s/^$1=//p" "$receipt")"
  [[ -n "$value" && "$value" != *$'\n'* ]] || pm_fail "backup receipt field invalid: $1"
  printf '%s' "$value"
}

[[ "$(receipt_value label)" == "$label" ]] || pm_fail 'backup receipt belongs to another label'
[[ "$(pm_sha256 "$dump")" == "$(receipt_value dump-sha256)" ]] || pm_fail 'backup dump hash mismatch'

objects="$(receipt_value objects)"
expected_count="$(receipt_value object-count)"
if [[ "$objects" == present ]]; then
  objects_dir="$backup_dir/$label.objects"
  hashes="$backup_dir/$label.objects.sha256"
  [[ -d "$objects_dir" && -f "$hashes" ]] || pm_fail 'backup objects missing'
  actual_count="$(find "$objects_dir" -type f | wc -l | tr -d ' ')"
  [[ "$actual_count" == "$expected_count" ]] || pm_fail "backup object count mismatch: expected $expected_count, got $actual_count"
  listed=0
  while read -r expected_hash relative_path; do
    [[ -f "$objects_dir/$relative_path" ]] || pm_fail 'backup object missing from manifest path'
    [[ "$(pm_sha256 "$objects_dir/$relative_path")" == "$expected_hash" ]] || pm_fail 'backup object hash mismatch'
    listed=$((listed + 1))
  done <"$hashes"
  [[ "$listed" == "$expected_count" ]] || pm_fail 'backup object manifest count mismatch'
elif [[ "$objects" != absent || "$expected_count" != 0 ]]; then
  pm_fail 'backup receipt object fields invalid'
fi
printf 'BACKUP_VERIFIED label=%s objects=%s object-count=%s\n' "$label" "$objects" "$expected_count"
