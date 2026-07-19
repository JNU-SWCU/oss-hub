# apps/frontend/src/components/ui — 에이전트 라우팅

`apps/frontend/src/components/ui/**` 작업에 적용된다. 더 가까운 `AGENTS.md`가 있으면 그 파일이 우선한다.

shadcn CLI가 소유하는 프리미티브 컴포넌트다.
CLI 재생성과의 충돌을 줄이기 위해 직접 수정은 최소화한다.
`apps/frontend/components.json`은 prettier 제외 대상이며 각 키와 값을 별도 줄에 두는 현재 형태를 유지해야 한다.
한 줄로 합치면 public-safe 검사가 인용부호 뒤에 오는 특정 특수문자를 이메일 후보로 오인해 오탐을 낸다.

원본: [루트 AGENTS.md](../../../../../AGENTS.md) · [apps/frontend/src/components](../AGENTS.md) · [보안 규칙](../../../../../docs/rules/security.md)
