<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-20 · Updated: 2026-07-30 (하위 모듈 문서 정리) -->

# apps/backend/src — 애플리케이션 코드

## Purpose

NestJS 모듈별 소스이며 모듈마다 폴더 하나를 쓴다.
`common/`·`prisma/`는 전 모듈이 공유하는 기반 계층이다.
`health/`·`audit-log/`·`consents/`·`login-history/`·`profiles/`·`ranking/`·`showcase/`·`users/`·`system-status/`·`repository-ownership/`·`runtime-config/`·`submission-reviews/`는 별도 문서 없이 이 문서가 다룬다.
`login-history/README.md`만 보존 정책을 추가로 설명한다.

## Key Files

| 파일 | 역할 |
| --- | --- |
| `app.module.ts` | 루트 모듈 — 전 모듈 조립, import 순서 자체가 계약(`collection`이 `ScheduleModule.forRoot()` 소유, `notifications`가 그 크론을 이어받으므로 반드시 뒤에 온다) |
| `main.ts` | 부트스트랩(전역 `ProblemDetailFilter` 등록 등) |
| `health/health.controller.ts`, `health/health.module.ts` | 헬스체크 엔드포인트 |

## Subdirectories

| 경로 | 내용 | 문서 |
| --- | --- | --- |
| `auth/` | GitHub OAuth 로그인·세션 | **경계 참조** — 아래 For AI Agents |
| `collection/` | GitHub 활동 수집기 | [collection/AGENTS.md](collection/AGENTS.md) |
| `common/` | 전 모듈 공유 에러·필터 | [common/AGENTS.md](common/AGENTS.md) |
| `applications/` | 프로그램 신청·판정 | [applications/AGENTS.md](applications/AGENTS.md) |
| `roles/` | 역할 온보딩·교직원 승인·관리자 사용자 관리 | [roles/AGENTS.md](roles/AGENTS.md) |
| `programs/` | 프로그램·마일스톤·팀 | [programs/AGENTS.md](programs/AGENTS.md) |
| `submissions/` | 제출물·파일 라이프사이클 | [submissions/AGENTS.md](submissions/AGENTS.md) |
| `submission-reviews/` | 제출 검토·저장소 공개 전환(`repositories/`의 `publish`를 소비) | — 이 문서가 다룸 |
| `repositories/` | GitHub 저장소 프로비저닝·공개 전환 | [repositories/AGENTS.md](repositories/AGENTS.md) |
| `notifications/` | 알림 설정·마감 다이제스트 메일 | [notifications/AGENTS.md](notifications/AGENTS.md) |
| `runtime-config/` | 전역 런타임 환경변수 snapshot | — 이 문서가 다룸 |
| `prisma/` | NestJS용 Prisma 서비스/모듈 래퍼(`prisma.service.ts`·`prisma.module.ts`) — 스키마·마이그레이션·시드는 `apps/backend/prisma/`(리포 루트 기준 다른 디렉터리)가 원본 |

## For AI Agents

- **`auth/`와 `collection/`의 작성권 경계는 루트 AGENTS.md §3이 원본이다.** 다른 레인은 직접 수정하지 않고 Issue 또는 PR 코멘트로 제안한다.
- 모듈 경계 lint는 다른 모듈의 `domain/*`·`dto/*` 직접 import만 제한한다.
- 모듈이 export하는 서비스나 Nest 모듈은 다른 모듈에서 사용할 수 있다.
- 도메인 실패 enum을 가진 모듈은 기존 prefix와 `DomainException` 경로를 유지한다.
- `submissions/`와 `submission-reviews/`는 독립 enum이면서 모두 `SUB_*` prefix를 쓰므로 실제 문자열 중복을 확인한다.
- 테스트는 `pnpm --filter backend test:unit`(기본)과 `test:integration`(`*.integration.spec.ts`, 격리 DB 컨테이너) 두 트랙으로 나뉜다 — 파일명이 트랙을 결정한다.

## Dependencies

- [apps/backend/AGENTS.md](../AGENTS.md) — 실행 명령·모듈 경계 전체 개요.
- [ADR-003](../../../docs/decisions/ADR-003-backend-architecture.md) — 모듈 경계 근거.
