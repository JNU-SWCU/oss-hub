<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-20 · Updated: 2026-08-02 (oss-hub seed 작업 중 PM이 교정한 Antipattern 섹션 추가) -->

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
- 시나리오 id 목록·`Application.answers`/`SubmissionRevision.content`의 placeholder 제약·초기 역할 부여가 이 시드가 아니라 `src/auth/auth.repository.ts`의 `AUTH_INITIAL_ROLES` 설정이 소유한다는 사실 등 상세는 **`README.md`가 원본**이다 — 이 문서에서 중복 서술하지 않는다.
- 로컬 DB 초기화는 `pnpm db:reset`(호스트 lane 개발 DB 대상 — 실행 전 팀과 확인). 대상 주소는 `.envrc`의 `DATABASE_URL`이며 `scripts/check-host-db-url.sh`가 로컬 여부와 `POSTGRES_PORT`·`POSTGRES_DB` 일치를 먼저 검증한다. CI/통합테스트는 매번 새로 띄우는 격리 컨테이너만 쓴다.

## Antipattern (Seed 작업)

PM 지시로 축적된, 이 디렉터리에서 seed를 만들거나 고칠 때 하지 말아야 할 것들이다.

1. 실명·실계정·시크릿을 tracked 파일에 넣지 않는다. 실제 팀원 계정은 `OSS_HUB_TEAM_ACCOUNTS` 같은 런타임 env로만 주입한다 — seed 소스·스펙·`README.md`·커밋 메시지·PR 본문 전부 해당한다.
2. 반쪽짜리 실제 데이터를 만들지 않는다. 실존 대상(예: 실제 GitHub repo URL)을 가리키면서 식별자만 합성값(가짜 `githubRepositoryId`)으로 채우는 혼합을 금지한다. 실존 대상은 실제 공개 메타데이터를 그대로 쓰고, 합성 fixture는 `seedGithubId`/`seedRepositoryId`(`seeds/helpers.ts`)가 만드는 예약 대역(synthetic ID band)을 써서 실존 값과 절대 충돌하지 않게 한다.
3. 화면에 티 나는 placeholder를 시연 데이터로 쓰지 않는다. `seed-program-basic` 같은 이름은 내부 fixture로만 쓴다. 사용자가 배포 화면에서 보게 될 시연용 데이터는 실제 공지·일정 형식의 그럴듯한 명칭을 쓴다.
4. 일정·마일스톤을 임의로 지어내지 않는다. 팀 canonical store(Notion "📅 Schedule" DB)의 실제 마일스톤과 정합시킨다. 단, 개인명이 포함된 항목은 반입하지 않는다.
5. collection/ranking 테이블에 합성 데이터를 넣지 않는다. 랭킹은 실제 GitHub 수집 파이프라인으로만 채운다 — seed는 platform 도메인(Program/Team/Repository 등)까지만 담당한다.
6. seed 로그·보고에 env 값을 echo하지 않는다. 존재 여부·개수·exit code만 남긴다.
7. production에서 seed를 실행하지 않는다. `assertSeedAllowed`/`assertOssHubSeedAllowed` gate를 우회하는 코드를 추가하지 않는다.
8. 결정적 seedId 키를 깨지 않는다. 키 체계(slug)를 바꿀 때는 기존 배포 DB에 orphan·중복 row가 남는지 반드시 검증하고(FK가 RESTRICT인 관계는 자식부터 지운다), 마이그레이션 방법을 `README.md`에 남긴다.

## Dependencies

- [README.md](README.md) — 시드 계약 원본(실행·시나리오 카탈로그·알려진 제약).
- `../src/auth/auth.repository.ts` — 이 시드와 `AUTH_INITIAL_ROLES` 역할 부여의 상호작용.
