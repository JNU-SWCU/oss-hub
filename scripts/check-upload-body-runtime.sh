#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo 'upload-body-runtime: usage: check-upload-body-runtime.sh <url> [curl args...]' >&2
  exit 1
fi

url=$1
shift

probe_bytes=${UPLOAD_BODY_PROBE_BYTES:-4194304}
probe_file=$(mktemp)
trap 'rm -f "$probe_file"' EXIT
head -c "$probe_bytes" /dev/zero >"$probe_file"

status=$(curl -o /dev/null -w '%{http_code}' --silent --show-error \
  --request POST "$@" \
  --form 'applicationId=smoke' \
  --form 'milestoneId=smoke' \
  --form "file=@${probe_file};filename=smoke.png;type=image/png" \
  "$url")

if [[ "$status" == "413" ]]; then
  printf 'upload-body-runtime: %s bytes 업로드가 413 으로 막힌다 url=%s — ingress client_max_body_size 를 확인하라\n' \
    "$probe_bytes" "$url" >&2
  exit 1
fi

if [[ "$status" != "401" ]]; then
  printf 'upload-body-runtime: url=%s expected=401 actual=%s\n' "$url" "$status" >&2
  exit 1
fi

printf 'upload-body-runtime: ok (%s bytes 가 backend 까지 도달해 401, url=%s)\n' "$probe_bytes" "$url"
