<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-20 · Updated: 2026-08-01 (todo 14 원자 전환 — writer/reader authority가 증분 저장소로 넘어갔다; todo 16 getRepositoryCumulativeMetrics/getContributorCumulativeMetrics 추가 반영; F3 감사 대응 — rollback은 배포 절차이지 코드 경로가 아니라는 판단과 그 preservation 불변식을 고정한 통합 테스트 반영) -->

# apps/backend/src/collection — GitHub 활동 수집기

## Purpose

Collection GitHub App installation token으로 `JNU-SWCU` 조직 설치 범위의 저장소 전체(visibility 무관, 조직 밖·개인 계정 repo는 제외) metadata·default-branch commit·all-state PR·published release를 REST-only로 읽어 canonical generation으로 발행하는 모듈. webhook·OAuth·PAT 수집 경로는 C2(#151, ADR-006)로 제거되었고 유일한 수집 authority는 REST reconciliation이다. private/public은 수집 허용 여부가 아니라 외부 응답 field/row 노출 허용 여부만 결정한다 — 정확한 범위·저장 field·누적 지표 계약은 ADR-006이 원본이며 이 문서는 요약을 반복하지 않는다. owner: @Lumiere001(루트 AGENTS.md §3) — 기능 코드 변경 전 Issue·PR 코멘트로 선점을 확인한다.

## Key Files

| 파일 | 역할 |
| --- | --- |
| `collection.module.ts` | 모듈 조립 — sync/cutover/reconciliation runtime을 각각 lazy singleton factory로 생성. `CollectionSyncService`가 유일하게 배선된 live writer이고, `CollectionReconciliationService`는 rollback 참조 코드로만 provider에 남는다(어떤 controller/scheduler도 더 이상 주입하지 않는다) |
| `collection-app.config.ts` | `GITHUB_APP_ORG`/`GITHUB_COLLECTION_APP_ID`/private key fail-closed 설정 |
| `collection-app.token.ts` | App JWT(PKCS#1/PKCS#8 모두 허용)·installation discovery·token cache/single-flight |
| `collection-app.client.ts` | REST inventory/commit/PR/release reader — bounded pagination·typed 오류 |
| `collection-reconciliation.service.ts` | (rollback 참조 전용, live writer 아님) fenced lease 기반 Org-wide atomic generation 수집·발행 — old canonical 테이블 authority |
| `collection-canonical.repository.ts` | canonical run/lease/generation/공개 contributor projection 영속화(rollback 참조 대상, 신규 런타임 쓰기 없음) |
| `collection-scheduler.service.ts` | 매시 정각(Asia/Seoul) cron 트리거. todo 14 전환 이후 `CollectionSyncService.run()`을 fire-and-forget으로 감싸 호출한다(즉시 PENDING 응답 계약 유지) — `CollectionCutoverLease`가 걸려 있으면 `COL_008`로 거부한다 |
| `collection-admin.controller.ts` | `POST /admin/collection/trigger` — ADMIN manual trigger(202/`COL_008`). scheduler와 동일하게 `CollectionSyncService`만 호출한다 |
| `collection-live-smoke.service.ts` | E1 live smoke(2-pass 멱등 digest, 공개-safe 출력) |
| `collection-error-code.enum.ts` | `COL_*` 에러 코드 레지스트리 — `COL_008 COLLECTION_QUIESCED`(409, cutover 절차 진행 중 트리거 거부) 포함 |
| `collection-generation-import.service.ts` | 최신 성공 활성 canonical generation → ADR-006 안정 ID facts/state/집계 backfill(멱등, ETag·safe frontier 미발명 — stream은 `VERIFYING`으로 남는다). todo 14 cutover 절차가 pin된 generation을 재확인하기 위해 이 backfill을 재실행한다 |
| `collection-sync.service.ts` | todo 10/14 — repository별 증분 동기화 orchestration이자 유일한 live writer. inventory(complete/partial 구분) → 신규/미검증 저장소 full backfill → READY 저장소 조건부 poll을 fair serial queue·lease-fenced 트랜잭션 위에서 durable cursor로 이어간다 |
| `collection-sync.types.ts` | `CollectionSyncLease` epoch-fenced lease 계약 타입(`SyncLeaseKey`/`SyncLeaseToken`/`AcquireSyncLeaseInput`) |
| `collection-cutover.types.ts` | todo 14 원자 전환 quiesce lease/결과 계약 타입(`CutoverLeaseKey`/`CutoverLeaseToken`/`CutoverAbortReason`/`CutoverAggregateComparison`/`CutoverResult`) |
| `collection-cutover.repository.ts` | `CollectionCutoverLease` epoch-fenced quiesce lease(acquire/release/`isQuiesced` 존재 확인) + aggregate 비교용 VERIFYING stream·facts count 조회 |
| `collection-cutover.service.ts` | ADR-006 "누적 저장소로의 1회 전환" orchestration. `CollectionCutoverLease` 아래에서 마지막 성공 generation을 pin → backfill 재실행 → 포인터 불변 확인 → provider 재순회로 VERIFYING 검증 → 원장/facts 개수 비교. 다섯 단계 중 하나라도 실패하면 명시적 `CutoverAbortReason`과 함께 ABORTED를 반환한다(예외를 던지지 않는다). CLI에서만 실행되며 scheduler/admin 배선에는 없다 |
| `collection-provider-queue.ts` | `ProviderRequestQueue` — 모든 provider 요청이 통과하는 fair serial fetcher wrapper(최소 250ms 페이싱, `x-ratelimit-*` 관찰, ADR-006 동적 정지 `remaining <= max(100, limit의 20%)`) |
| `collection-read.port.ts` | `COLLECTION_READ_PORT` DIP 경계 — ranking·programs·system-status·public-projects가 이 8개 메서드/DTO로만 collection을 소비한다. todo 14 전환 이후 `findRepositoryActivity`(유일한 활성 운영 호출자, `program-activity.service.ts`)는 증분 저장소를 직접 읽는다. `findRankingActivity`/`getStatusSnapshot`은 운영 호출자가 없어 old canonical 테이블 배선 그대로 남아 ADR-006이 요구하는 "1개 릴리스 동안 rollback 참조용 old reader" 역할을 자연히 겸한다. todo 11이 `getRepositoryMetrics`/`getContributorMetrics`를 추가만 했다(배치 `repositoryIds[]` 조회, `dataAsOf`, `visibility`/`presence`/`visibilityObservedAt` eligibility-safe 방문성 DTO 포함 — 실명·studentId·raw payload·collection lease/frontier 등 control 필드 없음). todo 12가 `getIncrementalStatusSnapshot`을 추가만 했다(system-status source — 조직 전체 stream count·checkpoint 시각만 노출, repository 이름/visibility 없음. health(empty/normal/delayed/partial/failed) 해석은 이 포트가 아니라 system-status 모듈 책임). todo 16이 `getRepositoryCumulativeMetrics`/`getContributorCumulativeMetrics`를 추가만 했다(`year` 필터 없이 전체 연도를 합산하는 lifetime 누적 — 공개 프로젝트 상세/프로필이 페이지당 상수 개수의 질의로 배치 조회한다. 기여자 지표는 githubLogin만 노출하고 platform User join이 없다) |
| `collection-read.service.ts` | `CollectionReadPort` 구현체. `findRepositoryActivity`는 todo 14 전환으로 `CollectionRepository`/commit·PR·release facts를 직접 읽는다(old canonical generation 테이블 아님). todo 11의 2개 메서드도 todo 8/10이 채운 증분 facts/aggregate 테이블을 직접 읽는다 — private facts도 내부적으로는 그대로 읽히며, 공개 안전 필터링은 이 서비스가 아니라 이를 소비하는 todo 15(eligibility fence)/todo 19(ranking source)의 책임이다. todo 12의 `getIncrementalStatusSnapshot`은 `CollectionRepositoryStream`/`CollectionSyncCursor`를 집계만 하고 repository 식별자를 select하지 않는다. todo 16의 2개 메서드는 `getRepositoryMetrics`/`getContributorMetrics`와 같은 aggregate 테이블을 `year` 없이 읽어 findMany 질의 1개로 합산한다(repositoryIds 배열 크기와 무관) |

## Subdirectories

| 경로 | 내용 |
| --- | --- |
| `dto/` | `collection-trigger-response.dto.ts` — 공개 응답 계약 |
| `cli/` | `verify-collection-app.ts` — live smoke 엔트리(`pnpm --filter backend collection:verify-app`) · `collection-generation-import.ts` — backfill 엔트리(`pnpm --filter backend collection:import-generation`) · `collection-sync.ts` — todo 10 증분 동기화 엔트리(`pnpm --filter backend collection:sync`) · `collection-cutover.ts` — todo 14 원자 전환 절차 엔트리(`pnpm --filter backend collection:cutover`, 사람이 지켜보며 1회 실행) |

## For AI Agents

- 에러 코드: `COL_006 COLLECTION_RUN_IN_PROGRESS`(409, 안전 확장 `activeRunId`만 노출, 현재 어떤 live 경로도 던지지 않는다 — old writer만 사용했다). `COL_008 COLLECTION_QUIESCED`(409, cutover 절차가 `CollectionCutoverLease`를 보유한 동안 scheduler/admin 트리거를 명시적으로 거부한다). `collection-error-code.enum.ts`에 등록하고 `DomainException`으로 던지면 `common/problem-detail.filter.ts`가 `application/problem+json`으로 변환한다.
- 테스트 위치·트랙:
  - 단위(`pnpm --filter backend test:unit`): `collection-app.client.spec.ts`, `collection-canonical.repository.spec.ts`, `collection-reconciliation.service.spec.ts`, `collection-scheduler.service.spec.ts`, `collection-admin.controller.spec.ts`, `collection-live-smoke.service.spec.ts`, `collection.module.spec.ts`, `collection-generation-import.service.spec.ts`, `collection-incremental.repository.spec.ts`, `collection-provider-queue.spec.ts`, `collection-sync.service.spec.ts`, `collection-read.service.spec.ts`, `collection-cutover.repository.spec.ts`, `collection-cutover.service.spec.ts`
  - 통합(`pnpm --filter backend test:integration`, 격리 DB 컨테이너): `collection-canonical.repository.integration.spec.ts`, `collection-reconciliation.integration.spec.ts`, `collection-scheduler.integration.spec.ts`, `integration-database.guard.spec.ts`, `collection-cutover-rollback.integration.spec.ts`
- todo 14 원자 전환(ADR-006) 이후 scheduler cron·admin manual trigger 모두 `CollectionSyncService.run()`만 호출한다 — hourly full-history reconciliation(`collection-reconciliation.service.ts`)은 더 이상 어떤 controller/scheduler에도 배선되지 않고, rollback 시 old canonical 테이블을 읽기 전용으로 참조하는 코드로만 provider에 남는다(1개 릴리스 동안 보존, 제거는 별도 GitHub Issue로 추적). `CollectionSyncService.run()`은 완료까지 await하는 동기 호출이라, 기존 "즉시 PENDING 반환 + 백그라운드 진행" 202 계약을 유지하려면 scheduler/admin이 `void`로 fire-and-forget 감싸 호출한다.
- reconciliation/sync 두 runtime 모두 `collection.module.ts`에서 lazy singleton factory로 생성된다 — 자격증명이 없는 환경에서 모듈 초기화가 실패하지 않고, 첫 트리거의 discovery/token 실패는 durable run 실패로 기록된다.
- `collection-sync.service.ts`는 자체 lease(`CollectionSyncLease`, epoch-fenced, `CollectionCanonicalLease`와 별개 테이블)와 durable cursor(`CollectionSyncCursor`)를 쓴다. inventory는 매 run 시도되며, complete(예외 없이 전체 목록 확보)한 경우에만 visibility/presence를 lease-fenced 독립 트랜잭션으로 갱신한다 — partial(예외 발생)인 run은 이미 관찰된 PRESENT 저장소로 stream sync만 계속하고 어떤 presence/visibility도 건드리지 않는다. 저장소별 stream(commit/PR/release)은 실제 provider traversal이 안전한 frontier를 확립했을 때만 `READY`로 승격되며(backfill이 만든 `VERIFYING` placeholder 포함), 이미 `READY`인 스트림은 조건부 probe만 수행하고 변경이 없으면 전체 이력 호출을 하지 않는다. 저장소 하나의 stream sync가 실패하면 그 run은 해당 저장소에서 멈추고 durable cursor를 그 저장소 너머로 전진시키지 않는다(재시도 없이 건너뛰지 않기 위한 의도된 trade-off — 지속 실패 저장소가 있으면 사이클이 정체될 수 있다).
- `collection-cutover.service.ts`는 `CollectionCutoverLease`(`CollectionCutoverRepository.acquireLease`/`releaseLease`, epoch-fenced, 별도 테이블)를 획득한 동안에만 절차를 진행한다 — 획득 실패는 `ALREADY_IN_PROGRESS`로 즉시 abort. 성공/abort 무관하게 `finally`에서 항상 lease를 해제해 scheduler/admin 트리거가 다시 열리도록 한다. `CollectionCutoverRepository.isQuiesced(now)`는 key 없이 활성 lease 존재 여부만 보는 값싼 게이트로, 단일 조직/앱 배포를 전제로 scheduler/admin이 매 트리거마다 확인한다.
- legacy 관측 테이블(`CollectionRun`·`GithubWebhookObservation` 등)은 호환 릴리스 동안 inert로 남는다 — 새 코드가 읽거나 쓰지 않는다(M3에서 제거). todo 14 이후로는 old canonical 테이블(`Canonical*`) 전체도 같은 성격의 "읽기 전용 rollback 참조"로 취급한다 — 1개 릴리스 보존 후 별도 마이그레이션으로 제거한다(GitHub Issue로 추적).
- **rollback은 런타임 코드 경로가 아니라 배포 절차다(F3 감사 대응).** `collection.module.ts`/`collection-scheduler.service.ts`/`collection-admin.controller.ts` 어디에도 old writer(`CollectionReconciliationService`)로 되돌리는 스위치·플래그·admin 엔드포인트가 없다 — scheduler cron과 admin manual trigger 둘 다 코드 레벨에서 `CollectionSyncService`만 호출하도록 고정 배선되어 있다. 즉 "rollback"은 이 저장소의 todo 14 이전 릴리스를 재배포하는 운영 절차이며, 그 절차가 안전하려면 old canonical 테이블(`Canonical*`)이 cutover 이후에도 새 writer에 의해 전혀 변경되지 않아야 한다. `collection-cutover-rollback.integration.spec.ts`가 실 Postgres로 이 불변식(새 writer 활동 이후에도 old canonical 원장 행과 `CollectionReadService.getStatusSnapshot`/`findRankingActivity`의 반환값이 정확히 동일)을 고정한다 — rollback 절차 자체(재배포 순서, 검증 체크리스트)는 코드가 아니므로 이 테스트의 범위 밖이다.

## Dependencies

- [apps/backend/src/AGENTS.md](../AGENTS.md) — 모듈 경계·auth/collection owner 경계.
- `auth/`(`AuthModule` — ADMIN 세션만 수집 트리거 허용).
- `common/`(에러 코드 규약 원본).
- [docs/decisions/ADR-006-github-app-integration.md](../../../../docs/decisions/ADR-006-github-app-integration.md) — REST-only authority·권한 allowlist·조직 전체 누적·증분 수집 계약(safe frontier·ETag·저장 field·공개 노출 revocation·세대 전환)·E1/C1/C2 계약 원본.
