<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-20 · Updated: 2026-08-01 (todo 10 repository별 증분 동기화 반영) -->

# apps/backend/src/collection — GitHub 활동 수집기

## Purpose

Collection GitHub App installation token으로 `JNU-SWCU` 조직 설치 범위의 저장소 전체(visibility 무관, 조직 밖·개인 계정 repo는 제외) metadata·default-branch commit·all-state PR·published release를 REST-only로 읽어 canonical generation으로 발행하는 모듈. webhook·OAuth·PAT 수집 경로는 C2(#151, ADR-006)로 제거되었고 유일한 수집 authority는 REST reconciliation이다. private/public은 수집 허용 여부가 아니라 외부 응답 field/row 노출 허용 여부만 결정한다 — 정확한 범위·저장 field·누적 지표 계약은 ADR-006이 원본이며 이 문서는 요약을 반복하지 않는다. owner: @Lumiere001(루트 AGENTS.md §3) — 기능 코드 변경 전 Issue·PR 코멘트로 선점을 확인한다.

## Key Files

| 파일 | 역할 |
| --- | --- |
| `collection.module.ts` | 모듈 조립 — canonical reconciliation runtime을 lazy singleton factory로 생성 |
| `collection-app.config.ts` | `GITHUB_APP_ORG`/`GITHUB_COLLECTION_APP_ID`/private key fail-closed 설정 |
| `collection-app.token.ts` | App JWT(PKCS#1/PKCS#8 모두 허용)·installation discovery·token cache/single-flight |
| `collection-app.client.ts` | REST inventory/commit/PR/release reader — bounded pagination·typed 오류 |
| `collection-reconciliation.service.ts` | fenced lease 기반 Org-wide atomic generation 수집·발행 |
| `collection-canonical.repository.ts` | canonical run/lease/generation/공개 contributor projection 영속화 |
| `collection-scheduler.service.ts` | 매시 정각(Asia/Seoul) cron 트리거 |
| `collection-admin.controller.ts` | `POST /admin/collection/trigger` — ADMIN manual trigger(202/COL_006) |
| `collection-live-smoke.service.ts` | E1 live smoke(2-pass 멱등 digest, 공개-safe 출력) |
| `collection-error-code.enum.ts` | `COL_*` 에러 코드 레지스트리 |
| `collection-generation-import.service.ts` | 최신 성공 활성 canonical generation → ADR-006 안정 ID facts/state/집계 1회 backfill(멱등, ETag·safe frontier 미발명 — stream은 `VERIFYING`으로 남는다) |
| `collection-sync.service.ts` | todo 10 — repository별 증분 동기화 orchestration. inventory(complete/partial 구분) → 신규/미검증 저장소 full backfill → READY 저장소 조건부 poll을 fair serial queue·lease-fenced 트랜잭션 위에서 durable cursor로 이어간다 |
| `collection-sync.types.ts` | `CollectionSyncLease` epoch-fenced lease 계약 타입(`SyncLeaseKey`/`SyncLeaseToken`/`AcquireSyncLeaseInput`) |
| `collection-provider-queue.ts` | `ProviderRequestQueue` — 모든 provider 요청이 통과하는 fair serial fetcher wrapper(최소 250ms 페이싱, `x-ratelimit-*` 관찰, ADR-006 동적 정지 `remaining <= max(100, limit의 20%)`) |

## Subdirectories

| 경로 | 내용 |
| --- | --- |
| `dto/` | `collection-trigger-response.dto.ts` — 공개 응답 계약 |
| `cli/` | `verify-collection-app.ts` — live smoke 엔트리(`pnpm --filter backend collection:verify-app`) · `collection-generation-import.ts` — backfill 엔트리(`pnpm --filter backend collection:import-generation`) · `collection-sync.ts` — todo 10 증분 동기화 엔트리(`pnpm --filter backend collection:sync`) |

## For AI Agents

- 에러 코드: `COL_006 COLLECTION_RUN_IN_PROGRESS`(409, 안전 확장 `activeRunId`만 노출). `collection-error-code.enum.ts`에 등록하고 `DomainException`으로 던지면 `common/problem-detail.filter.ts`가 `application/problem+json`으로 변환한다.
- 테스트 위치·트랙:
  - 단위(`pnpm --filter backend test:unit`): `collection-app.client.spec.ts`, `collection-canonical.repository.spec.ts`, `collection-reconciliation.service.spec.ts`, `collection-scheduler.service.spec.ts`, `collection-admin.controller.spec.ts`, `collection-live-smoke.service.spec.ts`, `collection.module.spec.ts`, `collection-generation-import.service.spec.ts`, `collection-incremental.repository.spec.ts`, `collection-provider-queue.spec.ts`, `collection-sync.service.spec.ts`
  - 통합(`pnpm --filter backend test:integration`, 격리 DB 컨테이너): `collection-canonical.repository.integration.spec.ts`, `collection-reconciliation.integration.spec.ts`, `collection-scheduler.integration.spec.ts`, `integration-database.guard.spec.ts`
- reconciliation runtime은 `collection.module.ts`에서 lazy singleton으로 생성된다 — 자격증명이 없는 환경에서 모듈 초기화가 실패하지 않고, 첫 트리거의 discovery/token 실패는 durable run 실패로 기록된다.
- 발행 규칙(현재 runtime): 완전한 generation만 `activeGenerationId`로 승격되고, 실패는 이전 complete generation을 유지한다. contributor projection은 public 저장소만 포함한다. 이 hourly full-history reconciliation은 여전히 유일하게 배선된(scheduler cron·admin trigger) 수집 경로다 — `collection-sync.service.ts`(todo 10)는 신규/미검증 저장소 full backfill과 READY 저장소 endpoint별 safe frontier 증분 전환을 구현한 별도 standalone 엔진이며, `collection:sync` CLI로만 실행된다. reconciliation → sync 전환(cutover)은 아직 별도 todo다.
- `collection-sync.service.ts`는 자체 lease(`CollectionSyncLease`, epoch-fenced, `CollectionCanonicalLease`와 별개 테이블)와 durable cursor(`CollectionSyncCursor`)를 쓴다. inventory는 매 run 시도되며, complete(예외 없이 전체 목록 확보)한 경우에만 visibility/presence를 lease-fenced 독립 트랜잭션으로 갱신한다 — partial(예외 발생)인 run은 이미 관찰된 PRESENT 저장소로 stream sync만 계속하고 어떤 presence/visibility도 건드리지 않는다. 저장소별 stream(commit/PR/release)은 실제 provider traversal이 안전한 frontier를 확립했을 때만 `READY`로 승격되며(backfill이 만든 `VERIFYING` placeholder 포함), 이미 `READY`인 스트림은 조건부 probe만 수행하고 변경이 없으면 전체 이력 호출을 하지 않는다. 저장소 하나의 stream sync가 실패하면 그 run은 해당 저장소에서 멈추고 durable cursor를 그 저장소 너머로 전진시키지 않는다(재시도 없이 건너뛰지 않기 위한 의도된 trade-off — 지속 실패 저장소가 있으면 사이클이 정체될 수 있다).
- legacy 관측 테이블(`CollectionRun`·`GithubWebhookObservation` 등)은 호환 릴리스 동안 inert로 남는다 — 새 코드가 읽거나 쓰지 않는다(M3에서 제거).

## Dependencies

- [apps/backend/src/AGENTS.md](../AGENTS.md) — 모듈 경계·auth/collection owner 경계.
- `auth/`(`AuthModule` — ADMIN 세션만 수집 트리거 허용).
- `common/`(에러 코드 규약 원본).
- [docs/decisions/ADR-006-github-app-integration.md](../../../../docs/decisions/ADR-006-github-app-integration.md) — REST-only authority·권한 allowlist·조직 전체 누적·증분 수집 계약(safe frontier·ETag·저장 field·공개 노출 revocation·세대 전환)·E1/C1/C2 계약 원본.
