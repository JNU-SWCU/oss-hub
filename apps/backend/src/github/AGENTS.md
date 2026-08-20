<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-20 · Updated: 2026-08-10 (fact writer의 가입자 경계를 ORG/EXTERNAL source-neutral로 통일하고 run/import당 가입자 snapshot 1회를 공유; system-status ADMIN 화면용 `getIncrementalStatusStreams`와 ADR-003 DEC-42 boundary-lint용 `getNextScheduledCycleAt` 추가) -->

# apps/backend/src/github — GitHub 연동 (프로비저닝 · 수집)

## Purpose

Collection GitHub App installation token으로 `JNU-SWCU` 조직 설치 범위의 저장소 전체(visibility 무관) metadata·default-branch commit·all-state PR·published release를 REST-only로 읽어 누적·증분 facts/aggregate 저장소에 적재하는 모듈(ADR-006 전환 이전의 org-wide canonical generation 발행 모델은 전환 완료 후 그 테이블과 함께 제거됐다). 단계 C(`GithubRepository` 통합·`source` enum `ORG_PROVISIONED`/`EXTERNAL_PUBLIC` 도입, `.omc/plans/github-repository-unification.md` §7)로 조직 밖 저장소를 담을 스키마 여지가 생긴 데 이어, 단계 E4가 학생 동의 범위 게이트(같은 문서 GR-14, `CONSENT_POLICY_VERSION` 현재 값에 GitHub 활동 동의 문서 갱신 완료)를 닫은 뒤 `EXTERNAL_PUBLIC` 수집 경로를 배선했다 — `CollectionDiscoveryClient`(GraphQL `contributionsCollection` discovery, private 저장소 자체 필터)와 `CollectionExternalDiscoveryService`(학생 GitHub login → 가입 활성 계정 확인 → discovery → `GithubRepository` upsert)가 `collection.module.ts`에 등록돼 있고, `POST /admin/collection/discover-external`로 ADMIN이 학생 1명 단위로 트리거한다. 이 경로가 실제로 읽는 조직 설치 범위 밖 저장소는 discovery client가 반환한 저장소 식별자·가시성·기본 브랜치·archived뿐이다(REST 상세 수집(commit/PR/release facts)은 아직 이 경로로 배선하지 않았다 — `collection-sync.service.ts`의 `runExternal`/`syncExternalInventory`는 이미 등록된 `EXTERNAL_PUBLIC` 행을 전제로 한 별도 REST 상세 sweep이고, 이번 배선은 그 전제가 되는 행을 만드는 discovery 단계까지다). webhook·OAuth·PAT를 **조직 저장소 수집의 authority로 되살리는 것**은 C2(#151, ADR-006:112)로 제거되었다 — `JNU-SWCU` installation 범위 저장소의 current-pointer authority는 여전히 Collection App installation token 기반 REST reconciliation 하나뿐이며, 그 자리에 webhook·OAuth·PAT를 병행하거나 fallback으로 되살리지 않는다. C2 자체가 조직 저장소 수집만을 대상으로 한 결정이라(#151 원문·ADR-006:119) **조직 밖 public repository 읽기는 애초에 C2의 대상이 아니었다** — installation access token은 installation이 승인받지 않은 저장소를 public이라도 읽을 수 없다는 GitHub 공식 제약(ADR-006:159-164) 때문에 구조적으로 별도 authority가 필요하고, 그 역할은 서비스 계정 PAT(`GITHUB_PUBLIC_READ_TOKEN`, ADR-006:166-170)가 맡는다 — C2를 번복(supersede)하지 않고, C2가 다루지 않은 스코프(조직 밖 수집)에 신설된 authority다. private/public은 수집 허용 여부가 아니라 외부 응답 field/row 노출 허용 여부만 결정한다 — 정확한 범위·저장 field·누적 지표 계약은 ADR-006이 원본이며 이 문서는 요약을 반복하지 않는다. owner: @Lumiere001(루트 AGENTS.md §3) — 기능 코드 변경 전 Issue·PR 코멘트로 선점을 확인한다.

## Key Files

| 파일 | 역할 |
| --- | --- |
| `collection.module.ts` | 모듈 조립 — sync runtime을 lazy singleton factory로 생성. `CollectionSyncService`가 유일한 live writer다. 전환 이후 rollback 참조용으로만 남아 있던 old canonical writer·전환 orchestration은 `Canonical*` 8개 테이블과 함께 제거됐다 |
| `collection-app.config.ts` | `GITHUB_APP_ORG`/`GITHUB_COLLECTION_APP_ID`/private key fail-closed 설정 |
| `collection-app.token.ts` | App JWT(PKCS#1/PKCS#8 모두 허용)·installation discovery·token cache/single-flight |
| `collection-app.client.ts` | REST inventory/commit/PR/release reader — bounded pagination·typed 오류. GraphQL 경로 3개(`resolveUserNodeId`, `listDefaultBranchCommitsByAuthor`, `countDefaultBranchCommits`)는 author-scoped 커밋 수집 전용이다 — `countDefaultBranchCommits`는 커밋 노드를 하나도 받지 않고 `totalCount`만 읽으며(개인 식별자 미전송), 브랜치가 없으면 0이 아니라 `null`을 돌려준다 |
| `collection-scheduler.service.ts` | 매시 정각(Asia/Seoul) cron 트리거. **세 sweep(org·external·person)** 을 한 tick에서 fire-and-forget으로 시작하고 각각 성공 1줄·실패 1줄을 남긴다 — 사람 축 실패 이벤트는 `collection.scheduler.person_sync_failed`이며 기존 두 sweep의 이벤트 이름은 그대로다. todo 14 전환 이후 `CollectionSyncService.run()`을 fire-and-forget으로 감싸 호출한다(즉시 PENDING 응답 계약 유지) — `CollectionCutoverLease`가 걸려 있으면 `COL_008`로 거부한다. #511 이후 성공 tick마다 `collection.scheduler.completed` 구조적 로그 1줄(소요 시간·대상 repo 수·신규 fact 수)을 남긴다 |
| `collection-admin.controller.ts` | `POST /admin/collection/trigger` — ADMIN manual trigger(202/`COL_008`). scheduler와 동일하게 `CollectionSyncService`만 호출한다. `POST /admin/collection/discover-external` — ADMIN이 학생 GitHub login 1건 단위로 external discovery를 즉시 실행하고 결과 집계(200)를 응답한다(E4, 백그라운드로 미루지 않는다). `GET /admin/collection/runs` — #511 실행 이력 조회(스키마 무접촉 프로젝션이라 scope당 최근 1건). 트리거는 `COLLECTION_SYNC_TRIGGERED` typed audit을 남긴다(#547) |
| `collection-discovery.client.ts` | GraphQL `contributionsCollection(from, to)` 기반 학생 기여 저장소 discovery(E4). private 저장소는 이 client가 직접 필터링한다. 인증은 `CollectionDiscoveryTokenProvider`(구조적 인터페이스) — installation JWT(`CollectionAppTokenProvider`)는 배선 금지, `CollectionPublicTokenProvider`만 배선한다 |
| `collection-public.token.ts` | 외부 public 저장소 수집용 서비스 계정 PAT(`GITHUB_PUBLIC_READ_TOKEN`) provider. 자격증명 부재는 생성자가 아니라 `getToken()` 최초 호출 시점에만 fail-closed로 검증한다 — 조직 collection은 이 키 없이도 계속 동작한다 |
| `collection-external-discovery.service.ts` | 학생 GitHub login → **가입 활성(`accountStatus: ACTIVE`) 계정 확인** → `CollectionDiscoveryClient` 호출 → `GithubRepository` `source: 'EXTERNAL_PUBLIC'` upsert(E4). 이미 `ORG_PROVISIONED`로 관찰된 저장소는 덮어쓰지 않고 건너뛴다(org/external 저장소 집합의 서로소 불변식 보호). **동의 게이트(`ConsentsService.requireCurrent`)는 이 배경 수집 경로에서 제거됐다** — 동의는 온보딩 경로(`roles`·`users`·`repository-own-enrollment`) 전속이고 배경 sweep이 그걸 두 번 묻지 않는다 |
| `collection-user-activity.service.ts` | **사람 축(person-axis) 활동 수집** — 가입 ACTIVE `User` 전원을 순회해 `CollectionDiscoveryClient.fetchUserActivityMetrics`(GraphQL, 서비스 계정 PAT)로 연도 지표 5종을 받아 `GithubUserActivityHistory`의 `(githubId, year)` 행으로 전량 재계산 upsert한다. 올해 행은 매 실행 갱신하고 과거 연도는 행이 있으면 재조회하지 않는다. 학생 단위 실패 격리 — 한 명 실패가 sweep을 세우지 않고 집계 수치만 로그에 남는다(토큰·저장소명·login 금지). `Contribution`(저장소 축)에는 아무것도 쓰지 않는다. 이번 배치는 **매 tick 전원 순회**이며 staleness 우선순위 드레인은 서비스 상단 주석의 성장 경로로만 남아 있다 |
| `collection-live-smoke.service.ts` | E1 live smoke(2-pass 멱등 digest, 공개-safe 출력) |
| `collection-error-code.enum.ts` | `COL_*` 에러 코드 레지스트리 — `COL_008 COLLECTION_QUIESCED`(409, cutover 절차 진행 중 트리거 거부) 포함 |
| `collection-sync.service.ts` | todo 10/14 — repository별 증분 동기화 orchestration이자 유일한 live writer. inventory(complete/partial 구분) → 신규/미검증 저장소 full backfill → READY 저장소 조건부 poll을 fair serial queue·lease-fenced 트랜잭션 위에서 durable cursor로 이어간다. `run`/`runExternal`은 트리거가 만든 runId를 받아 lease에 그대로 쓴다(#546). stream 실패는 `lastErrorCode`(public-safe 분류)로 남기고 성공하면 지운다 — run budget 소진(deadline)은 오류로 세지 않는다. **저장소 실패는 스윕을 세우지 않는다**(ADR-010 §6) — 실패해도 커서는 전진하고, 그 저장소는 `failureCount`와 `nextRunAt` 지수 백오프(상한 6시간)로 뒤로 밀린다. 예전에는 실패 지점에서 커서를 세워 뒤의 모든 저장소가 굶었다. 성공하면 `failureCount`를 0으로 되돌리고 `lastSuccessAt`을 남기며 `nextRunAt`은 앞으로 밀지 않는다 — 수집 주기는 스케줄러가 소유한다. **commit stream은 팀이 있는 저장소에서 author-scoped다** — `GithubRepository.teamId` → `TeamMember` → `User`로 팀원을 구하고 팀원마다 `resolveUserNodeId`+`listDefaultBranchCommitsByAuthor`를 돌려 결과를 합친다. 이 경로는 frontier를 읽지도 쓰지도 않는다(`history(author:)`가 전체 이력을 cost 1점에 주므로 증분 이득이 없고, 중복은 `@@unique([repositoryId, sha])`가 막는다) — 그래서 새 팀원의 과거 이력이 별도 백필 없이 다음 run에 들어온다. checkpoint는 `frontierSha`/`etag`를 null로 남겨, 나중에 팀을 잃어 REST 경로로 떨어져도 이력이 잘리지 않게 한다. **PR stream은 팀원 id 집합의 versioned SHA-256 fingerprint를 `frontierSha`에 저장한다** — 기존 표식과 달라진 sweep에만 PR tie frontier를 한 번 무시해 새 팀원의 과거 PR을 백필하고, 같은 fingerprint가 저장된 다음 sweep부터 증분 커서를 재사용한다. 팀원 조회 결과도 run 시작 가입자 snapshot으로 먼저 좁혀 세 stream과 fingerprint가 같은 사람축을 쓰므로, run 도중 가입한 계정의 fact만 거르고 백필 완료 표식은 남기는 경합이 없다. 팀을 특정할 수 없는 저장소(`GithubRepository.teamId` null)는 저장소 전량 REST 경로를 쓰되, 중앙 fact writer가 ORG/EXTERNAL 구분 없이 `githubId ∈ User`를 다시 강제해 미가입자·작성자 불명 신원은 원본 fact와 `Contribution`에 적재하지 않는다. 이 가입자 집합은 run 시작 때 한 번 고정해 모든 저장소·stream writer에 공유하고, 조회 실패는 inventory와 fact write 전에 run을 실패시킨다(D9). 외부(비팀원) 기여는 `전체 − 팀원합` **수치만** 구조적 로그로 관측하고 버린다 — 저장 위치 미정이며 개인 식별자는 저장하지 않는다. 기존 fact·`Contribution`을 지우는 runtime 정리는 두지 않는다 — 신규 적재 예방과 기존 운영 데이터 정리를 분리한다 |
| `collection-sync.types.ts` | `CollectionSyncLease` epoch-fenced lease 계약 타입(`SyncLeaseKey`/`SyncLeaseToken`/`AcquireSyncLeaseInput`) |
| `collection-cutover.types.ts` | todo 14 원자 전환 quiesce lease/결과 계약 타입(`CutoverLeaseKey`/`CutoverLeaseToken`/`CutoverAbortReason`/`CutoverAggregateComparison`/`CutoverResult`) |
| `collection-cutover.repository.ts` | `CollectionCutoverLease` epoch-fenced quiesce lease(acquire/release/`isQuiesced` 존재 확인) + aggregate 비교용 VERIFYING stream·facts count 조회. fact count는 live User JOIN이 아니라 cutover 시작 때 받은 가입자 snapshot을 명시적으로 적용한다 |
| `collection-provider-queue.ts` | `ProviderRequestQueue` — 모든 provider 요청이 통과하는 fair serial fetcher wrapper(최소 250ms 페이싱, `x-ratelimit-*` 관찰, ADR-006 동적 정지 `remaining <= max(100, limit의 20%)`) |
| `collection-read.port.ts` | `COLLECTION_READ_PORT` DIP 경계 — ranking·programs·system-status·public-projects가 이 포트의 메서드/DTO로만 collection을 소비한다. todo 14 전환 이후 `findRepositoryActivity`(유일한 활성 운영 호출자, `program-activity.service.ts`)는 증분 저장소를 직접 읽는다. 예전에 이 포트에 남아 있던 rollback 참조용 reader 2개(old canonical 테이블을 읽던 랭킹 활동 조회와 상태 스냅샷)는 **제거됐다** — ADR-006이 요구한 "1개 릴리스 보존"을 훨씬 넘게 경과했고(cutover는 v0.6.73 이전, 랭킹은 v0.6.88에서 사람 축으로 전환됐다) 그 둘은 끝까지 운영 호출자가 0건이었다. 이후 `Canonical*` 8개 테이블이 제거되면서 같은 이름의 메서드를 갖고 있던 canonical repository와 그 유일한 호출자였던 old writer도 함께 사라졌다 — 이제 이 이름은 이 포트 어디에도 없다. todo 11이 `getRepositoryMetrics`/`getContributorMetrics`를 추가만 했다(배치 `repositoryIds[]` 조회, `dataAsOf`, `visibility`/`presence`/`visibilityObservedAt` eligibility-safe 방문성 DTO 포함 — 실명·studentId·raw payload·collection lease/frontier 등 control 필드 없음). todo 12가 `getIncrementalStatusSnapshot`을 추가만 했다(system-status source — 조직 전체 stream count·checkpoint 시각만 노출, repository 이름/visibility 없음. health(empty/normal/delayed/partial/failed) 해석은 이 포트가 아니라 system-status 모듈 책임). todo 16이 `getRepositoryCumulativeMetrics`/`getContributorCumulativeMetrics`를 추가만 했다(`year` 필터 없이 전체 연도를 합산하는 lifetime 누적 — 공개 프로젝트 상세/프로필이 페이지당 상수 개수의 질의로 배치 조회한다. 기여자 지표는 githubLogin만 노출하고 platform User join이 없다). **2026-08 owner 결정**으로 `getIncrementalStatusStreams`를 추가했다 — `getIncrementalStatusSnapshot`이 지켜온 "repository 이름/visibility를 절대 포함하지 않는다"는 집계 전용 경계였고, ADMIN 전용 system-status 화면이 저장소·stream 단위로 무엇이 언제 수집됐는지 보여줘야 한다는 관측성 요구 때문에 그 경계를 옮겼다. 저장소 이름·stream별 상태/오류를 그대로 반환하지만, 소비처는 system-status의 ADMIN 가드 뒤로만 한정된다(포트 자체는 이 제약을 강제하지 않는다 — 호출자 쪽 책임). **ADR-003 DEC-42 boundary-lint 수정**으로 `getNextScheduledCycleAt(from: Date): Promise<Date \| null>`을 추가했다 — system-status가 다음 수집 사이클 예정 시각을 계산하려면 실제 배선된 cron 표현식(`collection-scheduler.service.ts`의 `COLLECTION_CRON_EXPRESSION`, concrete 구현)을 읽어야 하는데, 그 상수를 github 모듈 밖에서 직접 import하면 boundary lint를 위반한다(`system-status.module.ts:4`에서 실제로 걸렸다). 계산 자체를 포트 뒤로 옮겨 cron 표현식·`CronTime` 사용을 github 모듈 안에 가둔다. |
| `collection-read.service.ts` | `CollectionReadPort` 구현체. `findRepositoryActivity`는 todo 14 전환으로 `CollectionRepository`/commit·PR·release facts를 직접 읽는다(old canonical generation 테이블 아님). todo 11의 2개 메서드도 todo 8/10이 채운 증분 facts/aggregate 테이블을 직접 읽는다 — private facts도 내부적으로는 그대로 읽히며, 공개 안전 필터링은 이 서비스가 아니라 이를 소비하는 todo 15(eligibility fence)/todo 19(ranking source)의 책임이다. todo 12의 `getIncrementalStatusSnapshot`은 `CollectionRepositoryStream`/`CollectionSyncCursor`를 집계만 하고 repository 식별자를 select하지 않는다. todo 16의 2개 메서드는 `getRepositoryMetrics`/`getContributorMetrics`와 같은 aggregate 테이블을 `year` 없이 읽어 findMany 질의 1개로 합산한다(repositoryIds 배열 크기와 무관). 2026-08 owner 결정으로 추가된 `getIncrementalStatusStreams`는 `getIncrementalStatusSnapshot`과 같은 추적 대상 조건(`presence: PRESENT`, `source: ORG_PROVISIONED`)으로 저장소를 고르되, `nameWithOwner`와 `streams` relation을 findMany 질의 1개(N+1 없음)로 함께 읽는다 — bucket 분류는 집계가 쓰는 우선순위(재시도 대기 > ready/backfilling > partial)를 stream 하나 단위로 반복한다. `getNextScheduledCycleAt`은 원래 `system-status.service.ts`의 private 메서드였다(`SYSTEM_STATUS_COLLECTION_CRON_EXPRESSION` DI 토큰으로 `COLLECTION_CRON_EXPRESSION`을 주입받았다) — boundary lint 위반이 드러나 그 로직을 그대로(try/catch → null 폴백 포함) 이 서비스로 옮기고 같은 모듈의 `COLLECTION_CRON_EXPRESSION` 상수를 직접 참조한다. |

## Subdirectories

| 경로 | 내용 |
| --- | --- |
| `dto/` | `collection-trigger-response.dto.ts` — 공개 응답 계약. `collection-external-discovery-request.dto.ts`/`collection-external-discovery-response.dto.ts` — `discover-external` 요청/응답 계약(E4). `collection-run-list-response.dto.ts` — `GET /admin/collection/runs` 응답 계약(#511, lease `ownerId`는 trigger 분류로만 환원해 노출) |
| `cli/` | `verify-collection-app.ts` — live smoke 엔트리(`pnpm --filter backend collection:verify-app`) · `collection-sync.ts` — todo 10 증분 동기화 엔트리(`pnpm --filter backend collection:sync`). 1회성 전환 엔트리 둘(backfill·cutover)은 전환이 완료되고 `Canonical*` 테이블이 제거되면서 함께 삭제됐다 |

## For AI Agents

- 에러 코드: `COL_006 COLLECTION_RUN_IN_PROGRESS`(409, 안전 확장 `activeRunId`만 노출, 현재 어떤 live 경로도 던지지 않는다 — old writer만 사용했다). `COL_008 COLLECTION_QUIESCED`(409, cutover 절차가 `CollectionCutoverLease`를 보유한 동안 scheduler/admin 트리거를 명시적으로 거부한다). `COL_009 EXTERNAL_STUDENT_NOT_FOUND`(404, `discover-external`에 넘긴 GitHub login으로 활성 학생 계정을 찾지 못함). `COL_010 EXTERNAL_DISCOVERY_FAILED`(502, discovery client 오류를 kind만 남기고 변환 — PAT 원문은 이 오류 경로 어디에도 담기지 않는다). 배경 수집 경로(`CollectionExternalDiscoveryService`·`CollectionUserActivityService`)는 동의 테이블을 조회하지 않으므로 `CON_003`을 더는 이 경로에서 던지지 않는다 — 동의 게이트는 온보딩 경로 전속이다. `collection-error-code.enum.ts`에 등록하고 `DomainException`으로 던지면 `common/problem-detail.filter.ts`가 `application/problem+json`으로 변환한다.
- 테스트 위치·트랙:
  - 단위(`pnpm --filter backend test:unit`): `collection-app.client.spec.ts`, `collection-scheduler.service.spec.ts`, `collection-admin.controller.spec.ts`, `collection-live-smoke.service.spec.ts`, `collection.module.spec.ts`, `collection-incremental.repository.spec.ts`, `collection-provider-queue.spec.ts`, `collection-sync.service.spec.ts`, `collection-read.service.spec.ts`, `collection-cutover.repository.spec.ts`, `collection-discovery.client.spec.ts`, `collection-public.token.spec.ts`, `collection-external-discovery.service.spec.ts`, `collection-user-activity.service.spec.ts`
  - 통합(`pnpm --filter backend test:integration`, 격리 DB 컨테이너): `collection-scheduler.integration.spec.ts`, `integration-database.guard.spec.ts`, `collection-user-activity.integration.spec.ts`(사람 축 sweep — 실 Postgres 적재·멱등·실패 격리·세 sweep 관측), `collection-user-activity.qa.integration.spec.ts`(프로덕션 실측 규모 51명 — 전원 순회·학생당 연도당 cost 1·중간 1명 429 격리)
- todo 14 원자 전환(ADR-006) 이후 scheduler cron·admin manual trigger 모두 `CollectionSyncService.run()`만 호출한다 — hourly full-history reconciliation은 어떤 controller/scheduler에도 배선되지 않았고, 보존 기간이 끝나 old canonical 테이블과 함께 제거됐다. `CollectionSyncService.run()`은 완료까지 await하는 동기 호출이라, 기존 "즉시 PENDING 반환 + 백그라운드 진행" 202 계약을 유지하려면 scheduler/admin이 `void`로 fire-and-forget 감싸 호출한다.
- reconciliation/sync 두 runtime 모두 `collection.module.ts`에서 lazy singleton factory로 생성된다 — 자격증명이 없는 환경에서 모듈 초기화가 실패하지 않고, 첫 트리거의 discovery/token 실패는 durable run 실패로 기록된다.
- `collection-sync.service.ts`는 자체 lease(`CollectionSyncLease`, epoch-fenced, `CollectionCanonicalLease`와 별개 테이블)와 durable cursor(`CollectionSyncCursor`)를 쓴다. inventory는 매 run 시도되며, complete(예외 없이 전체 목록 확보)한 경우에만 visibility/presence를 lease-fenced 독립 트랜잭션으로 갱신한다 — partial(예외 발생)인 run은 이미 관찰된 PRESENT 저장소로 stream sync만 계속하고 어떤 presence/visibility도 건드리지 않는다. 저장소별 stream(commit/PR/release)은 실제 provider traversal이 안전한 frontier를 확립했을 때만 `READY`로 승격되며(backfill이 만든 `VERIFYING` placeholder 포함), 이미 `READY`인 스트림은 조건부 probe만 수행하고 변경이 없으면 전체 이력 호출을 하지 않는다. 저장소 하나의 stream sync가 실패하면 그 run은 해당 저장소에서 멈추고 durable cursor를 그 저장소 너머로 전진시키지 않는다(재시도 없이 건너뛰지 않기 위한 의도된 trade-off — 지속 실패 저장소가 있으면 사이클이 정체될 수 있다).
- 전환 orchestration(`CollectionCutoverLease`를 잡고 절차를 진행하던 서비스)은 제거됐지만 **`CollectionCutoverRepository`와 그 lease 테이블은 남는다** — `CollectionCutoverRepository.isQuiesced(now)`는 key 없이 활성 lease 존재 여부만 보는 값싼 게이트로, 단일 조직/앱 배포를 전제로 scheduler/admin이 매 트리거마다 확인한다.
- legacy 관측 테이블 중 `GithubWebhookObservation`은 제거했다(`20260804130000_drop_dead_observation_tables`) — 애플리케이션 코드·스펙 어디서도 참조되지 않아 검증 후 드롭했다. `CollectionRun`·`GithubRawObservation`은 호환 릴리스 동안 inert로 계속 남는다 — 새 코드가 읽거나 쓰지 않지만 `collection-incremental-migration.integration.spec.ts`가 두 테이블의 물리적 존재를 단언하므로 그 스펙을 먼저 갱신하기 전에는 제거하지 않는다(M3에서 재검토). old canonical 테이블(`Canonical*`) 8개는 **제거됐다**(`20260820000000_drop_canonical_generation_tables`) — ADR-006이 정한 1개 릴리스 보존 기간을 넘기고 전 테이블 0행을 실측한 뒤 단일 FK 클러스터를 통째로 드롭했고, 같은 통합 스펙이 이제 그 부재를 단언한다.
- **rollback은 런타임 코드 경로가 아니라 배포 절차다(F3 감사 대응).** `collection.module.ts`/`collection-scheduler.service.ts`/`collection-admin.controller.ts` 어디에도 old writer로 되돌리는 스위치·플래그·admin 엔드포인트가 없다 — scheduler cron과 admin manual trigger 둘 다 코드 레벨에서 `CollectionSyncService`만 호출하도록 고정 배선되어 있다. 즉 "rollback"은 이 저장소의 이전 릴리스를 재배포하는 운영 절차였고, 그 절차를 받치던 코드 측 불변식(새 writer가 old canonical 테이블을 건드리지 않는다)은 전용 통합 스펙이 실 Postgres로 고정했었다. **그 스펙과 rollback 참조 reader 둘, 그리고 old writer·canonical 테이블 자체가 모두 제거됐다** — ADR-006이 정한 보존 기간(1개 릴리스)을 훨씬 넘기면서 `Canonical*` 8개가 전부 0행이라(2026-08-19 프로덕션 실측) 보존할 rollback 원본 자체가 없고, 테이블이 사라지면 그 불변식이 묻는 질문도 소멸하기 때문이다. 이제 collection 모듈에는 old canonical 테이블을 읽는 rollback 전용 코드 경로가 없다 — 되돌리기는 이전 릴리스 재배포 + 백업 restore라는 순수 운영 절차다.

## Dependencies

- [apps/backend/src/AGENTS.md](../AGENTS.md) — 모듈 경계·auth/collection owner 경계.
- `auth/`(`AuthModule` — ADMIN 세션만 수집 트리거 허용).
- `common/`(에러 코드 규약 원본).
- [docs/decisions/ADR-006-github-app-integration.md](../../../../docs/decisions/ADR-006-github-app-integration.md) — REST-only authority·권한 allowlist·조직 전체 누적·증분 수집 계약(safe frontier·ETag·저장 field·공개 노출 revocation·세대 전환)·E1/C1/C2 계약 원본.

---

## 프로비저닝 (옛 `repositories/`)

`collection/`과 `repositories/`는 같은 GitHub App 자격증명·같은 rate limit 예산을 쓰면서
클라이언트가 2벌, 토큰 provider 가 3벌이었다. 한도가 계정 단위인데 사용량을 각자만 알면
페이싱이 성립하지 않으므로 한 폴더로 합쳤다(ADR-010 §8).

두 관심사는 답하는 질문이 다르다.
- **프로비저닝**: "내 저장소 준비됐나" — 신청 직후 몇 분, 학생 본인이 본다
- **수집**: "얼마나 기여했나" — 매시, 모두가 본다

그래서 port 도 갈라져 있다 — 기여 추적 3개(기여 집계·공개 자격·건강)와
프로비저닝 1개(`REPOSITORIES_READ_PORT`)를 별도로 등재한다(ADR-003 DEC-42 개정).

### 옛 문서 본문
## Purpose

승인된 신청의 GitHub 저장소 생성, 협업자 초대, 공개 전환을 담는다.
`applications/`의 outbox 이벤트를 consumer와 worker가 비동기로 처리한다.

## Key Files

| 파일 | 역할 |
| --- | --- |
| `repository-outbox.consumer.ts` | `OutboxEvent` 테이블에서 lease 기반으로 이벤트를 클레임(`SKIP LOCKED`) |
| `repository-provision.worker.ts` | GitHub 저장소 생성·협업자 초대 실행, 실패 시 재시도(`nextAttemptAt`, 최대 5회) |
| `repository-provision.scheduler.ts` | 5초 간격 polling(`@Interval`)으로 outbox→worker 배치 처리 |
| `repository-provision.github.ts` | 저장소 이름 충돌 시 fallback 이름으로 재시도하는 find-or-create 로직 |
| `repository-name.ts` | 결정적 저장소 이름 생성(`buildRepositoryNames`) — ASCII slug + stable id prefix |
| `github-app.client.ts` | GitHub App 설치 토큰으로 저장소 생성/조회/공개전환/협업자 초대 REST 호출 |
| `github-app.token.ts` | GitHub App 설치 토큰 발급·캐시 |
| `github-app.error.ts` | GitHub App REST 호출 에러 타입 |
| `github-app.response.ts` | GitHub App REST 응답 타입 |
| `github-operations.config.ts` | GitHub 저장소 조작 관련 설정 |
| `repository-provision-job.repository.ts` | provision job Prisma 접근 |
| `repository-provision-state.repository.ts`, `.helpers.ts` | provision 상태 전이 Prisma 접근·헬퍼 |
| `repository-provision.contract.ts` | provision 단계 타입 계약 |
| `repository-provision.failure.ts` | provision 실패 분류 |
| `repository-provision-event.ts` | provision 이벤트 타입 |
| `repositories.repository.ts` | `publishRepositoryIfPrivate` — CAS(compare-and-swap) 전환 구현 |
| `repositories.service.ts` | `getMyRepositories`(내 저장소 목록) · `publish`(비공개→공개 전환, CAS + 트랜잭션 내 typed audit) |
| `repositories.controller.ts` | `GET /repositories/me` |

## Subdirectories

| 경로 | 내용 |
| --- | --- |
| `dto/` | `my-repositories-response.dto.ts` |

## For AI Agents

- 이 모듈은 전용 error-code enum 대신 `GithubOperationsError`와 일반 `Error` 서브클래스를 쓴다.
- 호출 모듈이 필요한 경우 이를 자기 도메인 `DomainException`으로 변환한다.
- `publish`는 `RepositoriesController`를 통해 직접 호출되지 않는다 — 현재 유일한 호출자는 `submission-reviews/submission-reviews.service.ts`이며, `RepositoriesModule`을 import해 `RepositoriesService`의 `publish`만 `Pick`으로 노출받는다(ADR-003 공개 표면 원칙). 호출 전 다섯 게이트(수동 확정 포함)는 `submission-reviews/`가 원본이다.
- `publish`의 실제 전환은 `repositories.repository.ts`의 `publishRepositoryIfPrivate` — `WHERE {id, githubRepositoryId, visibility: PRIVATE}` 조건의 Prisma `updateMany` CAS이며 갱신 행이 0이면 "이미 전환됨"으로 보고 boolean으로 승패(`won`)를 반환한다.
- CAS에서 이긴 호출만 같은 트랜잭션 안에서 `REPOSITORY_PUBLISHED` typed audit(`audit-log/`)을 쓴다 — 진 호출은 audit을 쓰지 않는다.
- `showcase/`로의 프로젝션 트리거는 제거됐다 — 이 모듈은 더 이상 `ShowcaseProjectionService`를 호출하지 않는다(`showcase/` 테이블은 read-only, 물리 삭제는 Issue #463).
- `buildRepositoryNames`는 프로그램·대상의 정규화 slug로 preferred 이름을 만들고, 빈 slug에는 stable ID prefix를 쓰며 collision fallback에는 신청 ID의 8자 prefix를 붙인다.
- `buildRepositoryOwnershipMarker`는 신청 ID의 SHA-256으로 소유권 marker를 만든다.

## Dependencies

- [apps/backend/src/AGENTS.md](../AGENTS.md) — 모듈 경계·에러 코드 규약.
- `auth/`(`AuthModule`), `audit-log/`(`publish` CAS 승자만 쓰는 typed audit).
- `submission-reviews/` — `publish`의 유일한 호출자, 다섯 게이트를 소유.
