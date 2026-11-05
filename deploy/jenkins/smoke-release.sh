#!/usr/bin/env bash
set -euo pipefail
set +x
: "${PUBLIC_ORIGIN:?}"
controller_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
curl_limits=(--connect-timeout 5 --max-time 15 --retry-max-time 30)
require_status() {
  local expected=$1 method=$2 url=$3 actual
  shift 3
  actual="$(curl "${curl_limits[@]}" -o /dev/null -w '%{http_code}' --silent --show-error --retry 5 --retry-connrefused --request "$method" "$@" "$url")"
  if [[ "$actual" != "$expected" ]]; then
    printf 'FAIL_CLOSED smoke: method=%s expected=%s actual=%s\n' "$method" "$expected" "$actual" >&2
    return 1
  fi
}
require_status 404 GET http://127.0.0.1:8081/
require_status 200 GET "$PUBLIC_ORIGIN/"
for origin in http://127.0.0.1:8081 "$PUBLIC_ORIGIN"; do
  headers=()
  if [[ "$origin" == http:* ]]; then
    headers=(-H 'Host: jnu-oss-hub.com' -H 'X-Vercel-Forwarded-For: 192.0.2.1')
  fi
  require_status 200 GET "$origin/api/v1/health" "${headers[@]}"
  for route in submission-files Submission-Files; do
    require_status 404 GET "$origin/api/v1/$route" "${headers[@]}"
    require_status 401 POST "$origin/api/v1/$route/checks" "${headers[@]}"
  done
  require_status 401 GET "$origin/api/v1/submission-files/1" "${headers[@]}"
  if [[ "$origin" == http:* ]]; then
    bash "$controller_dir/deploy/jenkins/check-upload-body-runtime.sh" "$origin/api/v1/milestone-document-files" "${curl_limits[@]}" --retry 5 --retry-connrefused "${headers[@]}"
  else
    UPLOAD_BODY_PROBE_BYTES=4718592 bash "$controller_dir/deploy/jenkins/check-upload-body-runtime.sh" "$origin/api/v1/milestone-document-files" "${curl_limits[@]}" --retry 5 --retry-connrefused
  fi
done
printf 'RELEASE_SMOKE=ok\n'
