#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'r2-retention-protection: %s\n' "$1" >&2
  exit 1
}

: "${BACKUP_DIR:?BACKUP_DIR is required}"
: "${R2_CUTOVER_PRE_HOLD_FILE:?R2_CUTOVER_PRE_HOLD_FILE is required}"
: "${R2_CUTOVER_HOLD_FILE:?R2_CUTOVER_HOLD_FILE is required}"
: "${R2_CUTOVER_CLEANUP_APPROVAL_FILE:?R2_CUTOVER_CLEANUP_APPROVAL_FILE is required}"

mode_of() {
  case "$(uname -s)" in
    Darwin) stat -f '%Lp' "$1" ;;
    Linux) stat -c '%a' "$1" ;;
    *) fail 'unsupported host for receipt mode check' ;;
  esac
}

require_private_file() {
  [ ! -L "$1" ] || fail 'receipt must not be a symlink'
  [ -f "$1" ] || fail 'receipt must be a regular file'
  [ "$(mode_of "$1")" = 600 ] || fail 'receipt mode must be 0600'
}

require_backup_name() {
  [[ "$1" =~ ^v[0-9]+\.[0-9]+\.[0-9]+-[0-9]+$ ]] ||
    fail 'invalid protected backup identity'
}

require_image_tag() {
  [[ "$1" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] ||
    fail 'invalid protected rollback image identity'
}

pre_hold_present=false
hold_present=false
cleanup_authorized=false
protected_object_backup=
protected_rollback_image_tag=

if [ -e "$R2_CUTOVER_PRE_HOLD_FILE" ] || [ -L "$R2_CUTOVER_PRE_HOLD_FILE" ]; then
  pre_hold_present=true
  require_private_file "$R2_CUTOVER_PRE_HOLD_FILE"
  mapfile -t pre_hold_lines < "$R2_CUTOVER_PRE_HOLD_FILE"
  [ "${#pre_hold_lines[@]}" -eq 2 ] || fail 'invalid pre-hold receipt shape'
  case "${pre_hold_lines[0]}" in
    object-backup-name=*) pre_hold_object_backup=${pre_hold_lines[0]#object-backup-name=} ;;
    *) fail 'invalid pre-hold backup field' ;;
  esac
  case "${pre_hold_lines[1]}" in
    rollback-image-tag=*) pre_hold_rollback_image_tag=${pre_hold_lines[1]#rollback-image-tag=} ;;
    *) fail 'invalid pre-hold image field' ;;
  esac
  require_backup_name "$pre_hold_object_backup"
  require_image_tag "$pre_hold_rollback_image_tag"
  protected_object_backup=$pre_hold_object_backup
  protected_rollback_image_tag=$pre_hold_rollback_image_tag
fi

if [ -e "$R2_CUTOVER_HOLD_FILE" ] || [ -L "$R2_CUTOVER_HOLD_FILE" ]; then
  hold_present=true
  require_private_file "$R2_CUTOVER_HOLD_FILE"
  mapfile -t hold_lines < "$R2_CUTOVER_HOLD_FILE"
  [ "${#hold_lines[@]}" -eq 4 ] || fail 'invalid hold receipt shape'
  case "${hold_lines[0]}" in
    rollback-hold-start-epoch=*) rollback_hold_start_epoch=${hold_lines[0]#rollback-hold-start-epoch=} ;;
    *) fail 'invalid authoritative hold start field' ;;
  esac
  case "${hold_lines[1]}" in
    protected-until-epoch=*) protected_until_epoch=${hold_lines[1]#protected-until-epoch=} ;;
    *) fail 'invalid hold expiry field' ;;
  esac
  case "${hold_lines[2]}" in
    object-backup-name=*) hold_object_backup=${hold_lines[2]#object-backup-name=} ;;
    *) fail 'invalid hold backup field' ;;
  esac
  case "${hold_lines[3]}" in
    rollback-image-tag=*) hold_rollback_image_tag=${hold_lines[3]#rollback-image-tag=} ;;
    *) fail 'invalid hold image field' ;;
  esac
  [[ "$rollback_hold_start_epoch" =~ ^[0-9]{10}$ ]] || fail 'invalid authoritative hold start'
  [[ "$protected_until_epoch" =~ ^[0-9]{10}$ ]] || fail 'invalid hold expiry'
  require_backup_name "$hold_object_backup"
  require_image_tag "$hold_rollback_image_tag"
  current_epoch=$(date +%s)
  [[ "$current_epoch" =~ ^[0-9]{10}$ ]] || fail 'invalid current epoch'
  (( rollback_hold_start_epoch <= current_epoch )) || fail 'authoritative hold start is in the future'
  (( protected_until_epoch == rollback_hold_start_epoch + 259200 )) || fail 'hold duration is not exactly 72 hours'
  if [ "$pre_hold_present" = true ] && {
    [ "$hold_object_backup" != "$pre_hold_object_backup" ] ||
      [ "$hold_rollback_image_tag" != "$pre_hold_rollback_image_tag" ]
  }; then
    fail 'pre-hold and hold identities disagree'
  fi
  protected_object_backup=$hold_object_backup
  protected_rollback_image_tag=$hold_rollback_image_tag
fi

if [ "$pre_hold_present" = true ] || [ "$hold_present" = true ]; then
  [ -d "$BACKUP_DIR/objects/$protected_object_backup" ] || fail 'protected backup is missing'
  docker image inspect \
    "oss-hub-frontend:${protected_rollback_image_tag}" \
    "oss-hub-backend:${protected_rollback_image_tag}" >/dev/null ||
    fail 'protected rollback image is missing'
fi

if [ -e "$R2_CUTOVER_CLEANUP_APPROVAL_FILE" ] || [ -L "$R2_CUTOVER_CLEANUP_APPROVAL_FILE" ]; then
  [ "$hold_present" = true ] || fail 'cleanup approval requires an authoritative hold receipt'
  [ "$pre_hold_present" != true ] || fail 'cleanup approval requires completed pre-hold transition'
  require_private_file "$R2_CUTOVER_CLEANUP_APPROVAL_FILE"
  mapfile -t approval_lines < "$R2_CUTOVER_CLEANUP_APPROVAL_FILE"
  [ "${#approval_lines[@]}" -eq 2 ] || fail 'invalid cleanup approval shape'
  case "${approval_lines[0]}" in
    rollback-hold-start-epoch=*) approved_hold_start_epoch=${approval_lines[0]#rollback-hold-start-epoch=} ;;
    *) fail 'cleanup approval does not cite the authoritative hold start' ;;
  esac
  case "${approval_lines[1]}" in
    approved-at-epoch=*) cleanup_approved_at_epoch=${approval_lines[1]#approved-at-epoch=} ;;
    *) fail 'invalid cleanup approval timestamp field' ;;
  esac
  [[ "$approved_hold_start_epoch" =~ ^[0-9]{10}$ ]] || fail 'invalid cleanup approval hold start'
  [[ "$cleanup_approved_at_epoch" =~ ^[0-9]{10}$ ]] || fail 'invalid cleanup approval timestamp'
  (( approved_hold_start_epoch == rollback_hold_start_epoch )) || fail 'cleanup approval hold start mismatch'
  (( cleanup_approved_at_epoch >= protected_until_epoch )) || fail 'cleanup approval predates hold expiry'
  (( cleanup_approved_at_epoch <= current_epoch )) || fail 'cleanup approval is future-dated'
  cleanup_authorized=true
fi

if { [ "$pre_hold_present" = true ] || [ "$hold_present" = true ]; } &&
  [ "$cleanup_authorized" != true ]; then
  printf 'protected:%s\n' "$protected_rollback_image_tag"
else
  printf 'cleanup-allowed\n'
fi
