# .github — 에이전트 라우팅

`.github/**` 작업에 적용된다. 더 가까운 `AGENTS.md`가 있으면 그 파일이 우선한다.

`workflows/ci.yml`은 경로별 검증·`public-safe`·`commitlint` required check의 원본이다.
`pull_request_template.md`는 PR 본문 형식, `CODEOWNERS`는 작성권(AGENTS.md §3)의 코드화다.
이 폴더는 자물쇠 역할이라 변경 자체가 리뷰 대상이며, PR·커밋 텍스트도 이 repo의 public-safe 범위에 포함된다.

원본: [루트 AGENTS.md §3](../AGENTS.md) · [CI 경로별 검증 계약](../docs/rules/ci-path-verification.md) · [보안 규칙](../docs/rules/security.md)
