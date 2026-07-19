<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-20 -->

# apps/backend/prisma — 에이전트 라우팅

## Purpose

`apps/backend/prisma/**` 작업에 적용된다. 더 가까운 `AGENTS.md`가 있으면 그 파일이 우선한다. Prisma 스키마·마이그레이션·시드 데이터를 담는다.

### 규칙 원본 링크

- [루트 AGENTS.md §3](../../../AGENTS.md)
- [ADR-003](../../../docs/decisions/ADR-003-backend-architecture.md)
- [보안 규칙](../../../docs/rules/security.md)

## Key Files

| 파일 | 역할 |
| --- | --- |
| `schema.prisma` | 데이터 모델 원본 |
| `seed.ts` | 시드 엔트리(`package.json`의 `prisma.seed` 훅) — profile을 읽어 `seeds/*`를 실행 |
| `seed.integration.spec.ts` | 시드 멱등성(같은 profile 재실행 시 행 수 불변) 검증 |
| `README.md` | 시드 실행법·시나리오 카탈로그·알려진 제약의 **원본** — 아래 계약은 요약이며, 전체 내용은 이 파일이 원본이다 |

## Subdirectories

| 경로 | 내용 |
| --- | --- |
| `migrations/` | 스키마 변경 이력. **직렬로만 적용한다** — 동시 마이그레이션 PR을 만들지 않는다(루트 AGENTS.md §3) |
| `seeds/` | 프로필별 시나리오(`auth.ts`·`intake.ts`·`milestones.ts`·`repositories.ts`) |

## For AI Agents

- **시드 프로필 계약**: `auth`(기본값)·`intake`·`milestones`·`repositories`·`all` 중 하나를 고른다.
  ```bash
  # 기본값(auth)
  pnpm --filter backend prisma db seed
  # 프로필 지정 — env
  SEED_PROFILE=intake pnpm --filter backend prisma db seed
  # 프로필 지정 — CLI 인자
  pnpm --filter backend prisma db seed -- --profile milestones
  ```
- `prisma migrate reset`/`migrate dev`는 이 시드 훅을 자동 실행한다(기본값 `auth`만). `prisma migrate deploy`(`scripts/run-backend-integration.sh` 경로)는 자동 시드를 실행하지 않는다. `NODE_ENV=production`에서는 실행이 거부된다.
- 모든 row는 결정적 id(`seed:...`)로 upsert되므로 같은 profile을 여러 번 실행해도 행 수가 늘지 않는다(멱등) — `seed.integration.spec.ts`가 이 성질을 검증한다.
- 시나리오 id 목록·`Application.answers`/`SubmissionRevision.content`의 placeholder 제약·admin 승격이 이 시드가 아니라 `src/auth/admin-bootstrap.ts` 소유라는 사실 등 상세는 **`README.md`가 원본**이다 — 이 문서에서 중복 서술하지 않는다.
- 로컬 DB 초기화는 `pnpm db:reset`(공유 개발 DB `localhost:5432/oss_hub` 대상 — 실행 전 팀과 확인). CI/통합테스트는 매번 새로 띄우는 격리 컨테이너만 쓴다.

## Dependencies

- [README.md](README.md) — 시드 계약 원본(실행·시나리오 카탈로그·알려진 제약).
- `../src/auth/test-role-map.ts`, `../src/auth/admin-bootstrap.ts` — 이 시드와 역할 매핑 상호작용.
