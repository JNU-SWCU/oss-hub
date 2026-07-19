# deploy — 에이전트 라우팅

`deploy/**` 작업에 적용된다. 더 가까운 `AGENTS.md`가 있으면 그 파일이 우선한다.

현재는 `nginx/nginx.conf` 하나뿐이다.
OAuth callback 경로는 query를 로그에 남기지 않는 별도 log_format을 쓴다.
변경 시 `scripts/probe-nginx-callback-log.sh`로 로그 계약이 깨지지 않는지 확인한다.

원본: [루트 AGENTS.md](../AGENTS.md) · [CI 경로별 검증 계약](../docs/rules/ci-path-verification.md) · [보안 규칙](../docs/rules/security.md)
