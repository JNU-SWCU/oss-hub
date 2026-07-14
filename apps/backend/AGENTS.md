# apps/backend — 에이전트 작업 규칙

루트 [AGENTS.md](../../AGENTS.md)가 지도(map)라면 이 파일은 이 폴더의 우선 규칙이다 (가까운 파일 우선).
원본은 [ADR-003](../../docs/decisions/ADR-003-backend-architecture.md)(구조)와
[ADR-004](../../docs/decisions/ADR-004-REST-API-규격.md)(API 계약) — 여기엔 요약만 담는다.

## 폴더 규칙

- `src/<기능>/` — 기능 모듈이 최상위 단위. 새 기능은 새 모듈 폴더로 시작한다 (`members/`가 참조 구현).
- 모듈 내부는 단방향 계층: `*.controller.ts`(HTTP·DTO 경계) → `*.service.ts`(usecase·트랜잭션
  소유) → `*.repository.ts`(영속성 전용).
  - controller는 repository에 직접 접근하지 않는다.
  - service는 프레임워크 전송 타입(Request/Response 등)에 의존하지 않는다.
  - repository는 Prisma row를 노출하지 않고 `domain/`의 도메인 타입만 반환한다.
- `src/<기능>/dto/` = API 계약, `src/<기능>/domain/` = 내부 모델 — 서로 분리 유지.
- `src/common/` — 전역 예외 필터(ProblemDetail)·공용 파이프만. 도메인 로직 금지.
- `src/prisma/` — PrismaService만. 스키마·마이그레이션 규칙은 [prisma/AGENTS.md](prisma/AGENTS.md)가 원본.

## API·오류 계약 (ADR-004 요약)

- 모든 라우트는 전역 접두사 `/api/v1` 아래, URL은 복수형 명사 + kebab-case.
- 도메인 오류는 모듈별 ErrorCode enum(`MEM_001` 형식). 전역 필터가 5xx의 도메인 코드를
  `SYS_*`로 치환하므로 외부 계약에는 4xx 코드만 노출한다.
- `BigInt`를 DTO·JSON 응답에 그대로 넣지 않는다 — 직렬화가 런타임에 실패한다.

## 패키지 명령

- `pnpm --filter backend lint` · `typecheck` · `test`(jest, DB 불필요 — 단위테스트만)
- DB가 필요한 작업(마이그레이션·dev 서버): 먼저 루트에서 `pnpm db:up` (Docker 필요)

## 금지

- 외부 HTTP 호출을 DB 트랜잭션 안에 두지 않는다 (service가 fetch와 짧은 트랜잭션을 분리 소유).
- 시크릿·실명·실데이터를 코드·테스트 fixture·로그에 넣지 않는다
  ([security.md](../../docs/rules/security.md)). fixture는 합성 데이터만.
