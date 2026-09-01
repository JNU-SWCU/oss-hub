#!/usr/bin/env bash
# Runs the migration operator in the already-built backend image. No provider is contacted by this wrapper.
set -euo pipefail
set +x
readonly BACKEND_IMAGE_PREFIX='oss-hub-backend:'
SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
readonly SCRIPT_DIR
readonly OPERATOR="$SCRIPT_DIR/object-storage-migration.mjs"
fail() { printf '%s\n' "object-storage-migration: $1" >&2; exit 1; }
usage() { printf '%s\n' 'usage: object-storage-migration.sh {preflight|inventory|copy-check|rollback-drill|reverse-copy-check} [argument]' >&2; }
require() { [ -n "${!1-}" ] || fail "missing required environment variable: $1"; }
private_directory() {
  local directory=$1 mode canonical
  case "$directory" in
    /*) ;;
    *) fail 'evidence directory must be an absolute path' ;;
  esac
  case "$directory" in
    *:*|*$'\n'*) fail 'evidence directory contains an unsafe mount character' ;;
  esac
  [ ! -L "$directory" ] || fail 'evidence directory must not be a symlink'
  [ -d "$directory" ] || fail 'evidence directory must already exist'
  case "$(uname -s)" in
    Darwin) mode=$(stat -f '%Lp' "$directory") ;;
    Linux) mode=$(stat -c '%a' "$directory") ;;
    *) fail 'unsupported host for evidence directory mode check' ;;
  esac
  [ "$mode" = 700 ] || fail 'evidence directory must have mode 0700'
  canonical=$(CDPATH='' cd -- "$directory" && pwd -P) || fail 'cannot canonicalize evidence directory'
  [ "$canonical" = "$directory" ] || fail 'evidence directory must be canonical'
  printf '%s\n' "$canonical"
}
[ "$#" -ge 1 ] || { usage; exit 2; }
command=$1; shift
case "$command" in
  preflight) [ "$#" -eq 0 ] || { usage; exit 2; } ;;
  inventory)
    if [ "$#" -ne 2 ] || { [ "$1" != source ] && [ "$1" != target ]; }; then
      usage
      exit 2
    fi
    evidence=$(private_directory "$2")
    set -- "$1"
    ;;
  copy-check|reverse-copy-check) [ "$#" -eq 1 ] || { usage; exit 2; }; evidence=$(private_directory "$1"); set -- ;;
  rollback-drill) [ "$#" -eq 2 ] || { usage; exit 2; }; evidence=$(private_directory "$2"); set -- "$1" ;;
  *) usage; exit 2 ;;
esac
require IMAGE_TAG
for variable in SOURCE_S3_MODE SOURCE_S3_ENDPOINT SOURCE_S3_REGION SOURCE_S3_ACCESS_KEY SOURCE_S3_SECRET_KEY SOURCE_S3_BUCKET SOURCE_S3_PATH_STYLE TARGET_S3_MODE TARGET_S3_ENDPOINT TARGET_S3_REGION TARGET_S3_ACCESS_KEY TARGET_S3_SECRET_KEY TARGET_S3_BUCKET TARGET_S3_PATH_STYLE; do require "$variable"; done
args=(run --rm --entrypoint node --user "$(id -u):$(id -g)" -v "$OPERATOR:/app/object-storage-migration.mjs:ro")
if [ "$command" != preflight ]; then args+=(-v "$evidence:/evidence:rw" -e MIGRATION_EVIDENCE_DIR=/evidence); fi
docker "${args[@]}" -e SOURCE_S3_MODE -e SOURCE_S3_ENDPOINT -e SOURCE_S3_REGION -e SOURCE_S3_ACCESS_KEY -e SOURCE_S3_SECRET_KEY -e SOURCE_S3_BUCKET -e SOURCE_S3_PATH_STYLE -e TARGET_S3_MODE -e TARGET_S3_ENDPOINT -e TARGET_S3_REGION -e TARGET_S3_ACCESS_KEY -e TARGET_S3_SECRET_KEY -e TARGET_S3_BUCKET -e TARGET_S3_PATH_STYLE -e WRITERS_STOPPED_ACK "${BACKEND_IMAGE_PREFIX}${IMAGE_TAG}" /app/object-storage-migration.mjs "$command" "$@"
