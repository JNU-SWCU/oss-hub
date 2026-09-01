#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd -P)
validator="$root/scripts/jenkins/r2-retention-protection.sh"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/r2-retention-protection.XXXXXX")
tmp=$(CDPATH='' cd -- "$tmp" && pwd -P)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/backups/objects/v1.2.3-42"

cat > "$tmp/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[ "${R2_RETENTION_TEST_DOCKER_FAIL:-0}" != 1 ]
EOF
chmod 755 "$tmp/bin/docker"

export PATH="$tmp/bin:$PATH"
export BACKUP_DIR="$tmp/backups"
export R2_CUTOVER_PRE_HOLD_FILE="$tmp/pre-hold"
export R2_CUTOVER_HOLD_FILE="$tmp/hold"
export R2_CUTOVER_CLEANUP_APPROVAL_FILE="$tmp/approval"

reset_receipts() {
  rm -f "$R2_CUTOVER_PRE_HOLD_FILE" "$R2_CUTOVER_HOLD_FILE" "$R2_CUTOVER_CLEANUP_APPROVAL_FILE"
}

write_pre_hold() {
  printf 'object-backup-name=v1.2.3-42\nrollback-image-tag=v1.2.3\n' > "$R2_CUTOVER_PRE_HOLD_FILE"
  chmod 600 "$R2_CUTOVER_PRE_HOLD_FILE"
}

write_hold() {
  local start=$1
  printf 'rollback-hold-start-epoch=%s\nprotected-until-epoch=%s\nobject-backup-name=v1.2.3-42\nrollback-image-tag=v1.2.3\n' \
    "$start" "$((start + 259200))" > "$R2_CUTOVER_HOLD_FILE"
  chmod 600 "$R2_CUTOVER_HOLD_FILE"
}

expect_status() {
  local expected=$1 actual
  actual=$("$validator")
  [ "$actual" = "$expected" ] || {
    printf 'expected status %s, got %s\n' "$expected" "$actual" >&2
    exit 1
  }
}

now=$(date +%s)

reset_receipts
expect_status cleanup-allowed

write_pre_hold
expect_status protected:v1.2.3

write_hold "$now"
expect_status protected:v1.2.3

printf 'object-backup-name=v1.2.3-42\nrollback-image-tag=v9.9.9\n' > "$R2_CUTOVER_PRE_HOLD_FILE"
chmod 600 "$R2_CUTOVER_PRE_HOLD_FILE"
"$validator" >/dev/null 2>&1 && exit 1 || true

reset_receipts
expired_start=$((now - 259201))
write_hold "$expired_start"
expect_status protected:v1.2.3

printf 'rollback-hold-start-epoch=%s\napproved-at-epoch=%s\n' "$expired_start" "$now" > "$R2_CUTOVER_CLEANUP_APPROVAL_FILE"
chmod 600 "$R2_CUTOVER_CLEANUP_APPROVAL_FILE"
expect_status cleanup-allowed

write_pre_hold
"$validator" >/dev/null 2>&1 && exit 1 || true
rm -f "$R2_CUTOVER_PRE_HOLD_FILE"

printf 'rollback-hold-start-epoch=%s\napproved-at-epoch=%s\n' "$expired_start" "$((expired_start + 259199))" > "$R2_CUTOVER_CLEANUP_APPROVAL_FILE"
chmod 600 "$R2_CUTOVER_CLEANUP_APPROVAL_FILE"
"$validator" >/dev/null 2>&1 && exit 1 || true

reset_receipts
write_pre_hold
chmod 644 "$R2_CUTOVER_PRE_HOLD_FILE"
"$validator" >/dev/null 2>&1 && exit 1 || true
chmod 600 "$R2_CUTOVER_PRE_HOLD_FILE"
R2_RETENTION_TEST_DOCKER_FAIL=1 "$validator" >/dev/null 2>&1 && exit 1 || true

reset_receipts
ln -s "$tmp/missing-pre-hold" "$R2_CUTOVER_PRE_HOLD_FILE"
"$validator" >/dev/null 2>&1 && exit 1 || true
rm -f "$R2_CUTOVER_PRE_HOLD_FILE"
ln -s "$tmp/missing-hold" "$R2_CUTOVER_HOLD_FILE"
"$validator" >/dev/null 2>&1 && exit 1 || true
rm -f "$R2_CUTOVER_HOLD_FILE"
ln -s "$tmp/missing-approval" "$R2_CUTOVER_CLEANUP_APPROVAL_FILE"
"$validator" >/dev/null 2>&1 && exit 1 || true

printf 'r2-retention-protection synthetic tests passed\n'
