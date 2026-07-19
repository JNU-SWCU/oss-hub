# apps/frontend/src/components — 에이전트 라우팅

`apps/frontend/src/components/**` 작업에 적용된다. 더 가까운 `AGENTS.md`가 있으면 그 파일이 우선한다.

여러 feature가 공유하는 공용 컴포넌트 트리다.
`index.ts` 배럴은 append-only이며 자기 몫의 export만 추가하고 기존 줄은 리팩터링하지 않는다.
컴포넌트 루트 엘리먼트에는 `data-slot`을 붙이는 관례를 따른다.
공용 경로이므로 루트 AGENTS.md §3의 Issue 선점 후 소형 PR 규칙을 적용한다.

원본: [루트 AGENTS.md §3](../../../../AGENTS.md) · [apps/frontend/src](../AGENTS.md) · [Frontend 구현 규칙](../../../../docs/rules/frontend.md)
