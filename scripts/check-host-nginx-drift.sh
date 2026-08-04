#!/usr/bin/env bash
# 호스트 nginx 의 실행 중 설정이 저장소 원본과 같은지 확인한다.
#
# 호스트 nginx 는 Compose 가 아니라 시스템 서비스라 배포 파이프라인이 파일을 반영하지
# 않는다. 반영은 `docs/deploy/server-runbook.md` 의 절차로 사람이 수행한다.
# 그래서 저장소 파일만 읽는 `check-host-nginx.sh` 는 green 이어도 서버가 다른 설정을
# 서빙할 수 있다 — 이 저장소가 겪은 nginx 드리프트 사고와 같은 구조다(ADR-002).
#
# 이 검사는 권한을 새로 요구하지 않는다. 활성 설정 파일이 0644 라 배포 계정이 읽을 수 있고,
# 내용이 갈라지면 배포를 fail-closed 로 세운다.
#
# 사용: check-host-nginx-drift.sh [저장소_파일] [활성_파일]
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
