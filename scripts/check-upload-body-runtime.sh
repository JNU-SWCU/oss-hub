#!/usr/bin/env bash
# 실행 중 ingress 가 제출 파일 업로드 본문을 실제로 통과시키는지 확인한다.
#
# nginx 의 client_max_body_size 기본값은 1m 이다. 저장소 설정에 한도를 적어두어도
# 실행 중 컨테이너가 옛 설정을 서빙하면 1MB 를 넘는 제출이 backend 에 닿기도 전에
# 413 으로 죽는다. 저장소 파일만 읽는 검사로는 이 드리프트를 증명할 수 없다(ADR-002).
#
# 미인증 요청이므로 backend 는 401 을 낸다. 401 이면 본문이 backend 까지 도달했다는 뜻이고,
# 413 이면 ingress 가 막은 것이다.
#
# 사용: check-upload-body-runtime.sh <url> [추가 curl 인자...]
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo 'upload-body-runtime: usage: check-upload-body-runtime.sh <url> [curl args...]' >&2
  exit 1
fi

url=$1
shift

probe_bytes=${UPLOAD_BODY_PROBE_BYTES:-2097152}
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
