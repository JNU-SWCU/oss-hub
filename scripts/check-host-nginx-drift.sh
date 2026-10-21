#!/usr/bin/env bash
set -euo pipefail

repo_config=${1:-deploy/host-nginx/oss-hub.conf}
live_config=${2:-/etc/nginx/conf.d/oss-hub.conf}

if [[ ! -f "$repo_config" ]]; then
  echo "host-nginx-drift: 저장소 원본이 없다: $repo_config" >&2
  exit 1
fi

if [[ ! -e "$live_config" ]]; then
  echo "host-nginx-drift: 활성 설정이 없다: $live_config — 호스트 nginx 에 반영되지 않았다" >&2
  exit 1
fi

if [[ ! -r "$live_config" ]]; then
  echo "host-nginx-drift: 활성 설정을 읽을 수 없다: $live_config" >&2
  exit 1
fi

if diff -q "$repo_config" "$live_config" >/dev/null 2>&1; then
  echo "host-nginx-drift: ok (저장소 원본과 활성 설정이 같다)"
  exit 0
fi

echo "host-nginx-drift: 저장소 원본과 활성 설정이 다르다" >&2
echo "  저장소: $repo_config" >&2
echo "  활성:   $live_config" >&2
echo "  배포 런북의 호스트 nginx 반영 절차를 수행한 뒤 다시 배포하라." >&2
echo "--- diff (저장소 → 활성) ---" >&2
diff -u "$repo_config" "$live_config" >&2 || true
exit 1
