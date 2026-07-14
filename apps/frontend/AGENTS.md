# apps/frontend — 에이전트 작업 규칙

루트 [AGENTS.md](../../AGENTS.md)가 지도(map)라면 이 파일은 이 폴더의 우선 규칙이다 (가까운 파일 우선).
원본은 [docs/rules/frontend.md](../../docs/rules/frontend.md)와 [ADR-004](../../docs/decisions/ADR-004-REST-API-규격.md) — 여기엔 요약만 담는다.

## 폴더 규칙

- `src/app/` — 라우팅·페이지 조합만. 업무 로직·데이터 fetch를 직접 두지 않는다.
- `src/features/<기능>/` — 기능 단위 응집(components/, hooks/, types.ts, api.ts).
  다른 feature의 내부 경로를 import하지 않는다 — 공유는 공용 계약으로 추출.
- `src/features/<기능>/api.ts` — endpoint 함수·DTO 변환만. `fetch`·별도 HTTP 인스턴스·
  `/api/v1` 문자열을 새로 만들지 않는다.
- `src/lib/api-client.ts` — 유일한 HTTP 클라이언트이자 `/api/v1`의 유일한 소유자.
  URL이 필요한 곳(링크 href 포함)은 여기의 export만 사용한다.
- dev의 `/api/v1` 프록시는 `next.config.ts` rewrite 담당 — 코드에 backend 절대 URL 금지.

## 컴포넌트·스타일 규칙

- 새 컴포넌트를 만들기 전에 `src/components/`(공용)와 해당 feature의 기존 컴포넌트를
  먼저 확인한다 — 중복 UI 금지. 공유되는 순수 UI는 `src/components/`로 올린다.
- 색·간격 등 스타일 값은 디자인 토큰이 정의된 뒤에는 토큰만 사용한다(하드코딩 금지).
  토큰 정의 전에는 임의 값 도입을 최소화한다.

## API 계약 (ADR-004 요약)

- 성공 = 순수 DTO, 실패 = ProblemDetail + 도메인 `code`. camelCase,
  enum은 UPPER_SNAKE_CASE, boolean은 is/has/can 접두사. 목록 API는 페이지네이션 전제.

## 패키지 명령

- `pnpm --filter frontend dev` · `lint` · `typecheck` · `test`(vitest) · `build`

## 금지

- 실명·학번·개인 머신 경로를 코드·주석·fixture에 넣지 않는다
  (PUBLIC repo — [security.md](../../docs/rules/security.md)). 실데이터 fixture 금지 — 합성만.
