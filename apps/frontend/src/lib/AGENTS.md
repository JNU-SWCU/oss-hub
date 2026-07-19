<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-20 -->

# apps/frontend/src/lib — 공유 유틸리티

## Purpose

`app → features → lib` 의존 방향의 최하위 계층. `features`에 의존할 수 없다. 이 앱의 유일한 HTTP 클라이언트(`api-client.ts`)가 여기 있다.

## Key Files

| 파일 | 역할 |
| --- | --- |
| `api-client.ts` | `apiClient<T>(path, init?)`, `apiPath(path)`, `ApiError`(`ProblemDetail` 래핑) — `/api/v1` baseURL의 **유일한** 소유자 |
| `utils.ts` | `cn(...)` — `clsx` + `tailwind-merge` 클래스 병합 헬퍼 |

## For AI Agents

- **모든 HTTP 요청은 `apiClient`/`apiPath`를 거친다.** 새 feature의 `api.ts`는 이 함수들만 호출하고, `fetch`를 직접 부르거나 `axios`/`ky`를 새로 도입하거나 `/api/v1` 문자열을 재정의하지 않는다 — `eslint.config.mjs`가 `lib/` 밖 전역에서 이를 lint 에러로 차단한다(`lib/`의 `api-client.ts` 자신과 그 테스트만 예외).
- `apiClient`는 실패 응답을 `ProblemDetail` 형식으로 파싱해 `ApiError`를 던진다. 백엔드가 `application/problem+json`이 아닌 응답을 주면(`isProblemDetail` 실패) `code: 'API_000'`인 합성 `ProblemDetail`로 감싼다 — 백엔드 `apps/backend/src/common/problem-detail.filter.ts`가 내려주는 필드(`type`/`title`/`status`/`detail`/`instance`/`code`)와 짝을 이룬다.
- baseURL(`/api/v1`)을 바꾸려면 이 파일 한 곳만 수정한다. feature별 우회 클라이언트를 만들지 않는다.
- 테스트: `api-client.test.ts`, `api-path.test.ts` (Vitest, `pnpm --filter frontend test`).

## Dependencies

- [apps/frontend/src/AGENTS.md](../AGENTS.md)
- [Frontend 구현 규칙](../../../../docs/rules/frontend.md) — 단일 API 클라이언트 규칙 원본.
- `clsx`, `tailwind-merge`.
