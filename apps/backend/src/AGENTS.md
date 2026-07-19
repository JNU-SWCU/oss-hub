# apps/backend/src — 에이전트 라우팅

`apps/backend/src/**` 작업에 적용된다. 더 가까운 `AGENTS.md`가 있으면 그 파일이 우선한다.

`auth/`는 GitHub OAuth 로그인, `collection/`은 GitHub 활동 수집기 기능 모듈이다.
`common/`은 전역 예외 필터 등 공용 코드이므로 루트 AGENTS.md §3의 공용 경로 규칙(Issue 선점 후 소형 PR)을 적용한다.
`health/`는 헬스체크, `prisma/`는 PrismaService 모듈이다.
각 모듈 내부의 controller → service → repository 계층 구조는 ADR-003이 원본이다.

원본: [루트 AGENTS.md §3](../../../AGENTS.md) · [ADR-003](../../../docs/decisions/ADR-003-backend-architecture.md)
