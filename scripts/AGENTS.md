# scripts — 에이전트 라우팅

`scripts/**` 작업에 적용된다. 더 가까운 `AGENTS.md`가 있으면 그 파일이 우선한다.

`check-public-safe.sh`(+ `.test.sh`)는 public-safe deny-list를 CI에서 강제하는 검사 로직의 원본이다.
`tidy-branches.sh`는 merge된 로컬 브랜치 정리를, `setup-hooks.sh`는 그 훅의 opt-in 활성화를 담당한다.
이 폴더는 CODEOWNERS 보호 대상이며 검사 로직을 약화시키는 변경은 owner 승인이 필요하다.

원본: [루트 AGENTS.md](../AGENTS.md) · [보안 규칙](../docs/rules/security.md) · [CI 경로별 검증 계약](../docs/rules/ci-path-verification.md)
