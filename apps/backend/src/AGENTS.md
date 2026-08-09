<!-- Parent: ../AGENTS.md -->
<!-- 2026-08-09: 폴더 재편(ADR-010 §8) — collection+repositories → github, program-overview·public-projects·public-eligibility → programs/archive, showcase 드롭. 3도메인은 controller/service/repository 계층을 쓴다. -->
<!-- Generated: 2026-07-20 · Updated: 2026-08-01 (public-projects/submission-reviews 문서화, audit-log 목록 오류·public-eligibility staleness 정정) -->

# apps/backend/src — 애플리케이션 코드

## Purpose

NestJS 모듈별 소스이며 모듈마다 폴더 하나를 쓴다.
`common/`·`prisma/`는 전 모듈이 공유하는 기반 계층이다.
`health/`·`consents/`·`login-history/`·`profiles/`·`ranking/`·`users/`·`system-status/`·`runtime-config/`·`programs/archive/public-eligibility/`는 별도 문서 없이 이 문서가 다룬다.
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
| `github/` | GitHub 활동 수집기 | [collection/AGENTS.md](collection/AGENTS.md) |
| `common/` | 전 모듈 공유 에러·필터 | [common/AGENTS.md](common/AGENTS.md) |
| `applications/` | 프로그램 신청·판정 | [applications/AGENTS.md](applications/AGENTS.md) |
| `audit-log/` | 불변 감사 원장(schemaVersion 1/2/legacy) | [audit-log/AGENTS.md](audit-log/AGENTS.md) |
| `roles/` | 역할 온보딩·RoleRequest 교직원 요청 흐름 | [roles/AGENTS.md](roles/AGENTS.md) |
| `users/` | 사용자 프로필·관리자 사용자 목록/상세·역할/접근 관리 | — 이 문서가 다룸 |
| `programs/` | 프로그램·마일스톤·팀 | [programs/AGENTS.md](programs/AGENTS.md) |
| `submissions/` | 제출물·파일 라이프사이클 | [submissions/AGENTS.md](submissions/AGENTS.md) |
| `submission-reviews/` | 제출 검토 + 저장소 수동 공개 확정(다섯 게이트 CAS+typed audit, `github/`의 `publish`를 소비) | [submission-reviews/AGENTS.md](submission-reviews/AGENTS.md) |
| `github/` | GitHub 저장소 프로비저닝·공개 전환(CAS `publishRepositoryIfPrivate` + 트랜잭션 내 typed audit) | [repositories/AGENTS.md](repositories/AGENTS.md) |
| `programs/archive/public-projects/` | 공개 프로젝트 목록(keyset cursor)·상세·공개 프로필 read API — 구 `showcase`/`profiles` 공개 read 라우트를 대체(404화) | — |
| `programs/archive/public-eligibility/` | todo 15 — platform 발행 + Collection freshness fence를 합치는 단일 public eligibility 정책(`PublicEligibilityService`). `programs/archive/public-projects/`(todo 16)가 유일한 소비자다 | — 이 문서가 다룸 |
| `notifications/` | 알림 설정·마감 다이제스트 메일 | [notifications/AGENTS.md](notifications/AGENTS.md) |
| `runtime-config/` | 전역 런타임 환경변수 snapshot | — 이 문서가 다룸 |
| `prisma/` | NestJS용 Prisma 서비스/모듈 래퍼(`prisma.service.ts`·`prisma.module.ts`) — 스키마·마이그레이션·시드는 `apps/backend/prisma/`(리포 루트 기준 다른 디렉터리)가 원본 |

## For AI Agents

- **`auth/`와 `github/`의 작성권 경계는 루트 AGENTS.md §3이 원본이다.** 다른 레인은 직접 수정하지 않고 Issue 또는 PR 코멘트로 제안한다.
- 모듈 경계 lint는 다른 모듈의 `domain/*`·`dto/*` 직접 import만 제한한다.
- 모듈이 export하는 서비스나 Nest 모듈은 다른 모듈에서 사용할 수 있다.
- 도메인 실패 enum을 가진 모듈은 기존 prefix와 `DomainException` 경로를 유지한다.
- `submissions/`와 `submission-reviews/`는 독립 enum이면서 모두 `SUB_*` prefix를 쓰므로 실제 문자열 중복을 확인한다.
- 테스트는 `pnpm --filter backend test:unit`(기본)과 `test:integration`(`*.integration.spec.ts`, 격리 DB 컨테이너) 두 트랙으로 나뉜다 — 파일명이 트랙을 결정한다.
- `github/` 밖에서는 `COLLECTION_READ_PORT`/`CollectionReadPort`/DTO로만 collection을 소비한다 — concrete 구현·Prisma delegate 직접 import는 `eslint.config.mjs`가 강제하는 4가지 경계로 차단된다(ADR-003 DEC-42, `common/architecture-boundary.eslint.spec.ts`가 회귀 고정).
- `showcase/`는 **제거됐다**(2026-08-09, Issue #463 흡수). 공개 read 는 `programs/archive/public-projects/`가 담당한다.

## Dependencies

- [apps/backend/AGENTS.md](../AGENTS.md) — 실행 명령·모듈 경계 전체 개요.
- [ADR-003](../../../docs/decisions/ADR-003-backend-architecture.md) — 모듈 경계 근거.
