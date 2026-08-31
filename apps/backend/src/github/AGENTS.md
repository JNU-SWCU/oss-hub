<!-- init:managed id=craft-init-4-github sha256=7b4c035bc980d2ab0cd5bbc9f8eb652061c5d16446261db3d0289874f2cc0500 -->
# github — 프로비저닝과 활동 수집

## Authority 분리

- `RepositoriesModule`의 저장소 프로비저닝/공개 전환과 `CollectionModule`의 활동 수집은 같은 디렉터리에 있지만 credential과 quota authority가 다르다.
- 승인 저장소 생성은 Operations GitHub App, 조직 collection은 Collection GitHub App, 외부 공개/person 읽기는 public-read PAT를 사용한다.
  credential이나 rate budget을 서로의 fallback으로 쓰지 않는다.
- secret, installation token, lease owner, private repository fact를 log·오류·public response에 노출하지 않는다.

## 프로비저닝과 공개 전환

- `repository-outbox.consumer.ts`가 lease와 `SKIP LOCKED`로 승인 event를 claim하고 scheduler가 `repository-provision.worker.ts`를 polling한다.
- worker는 durable job 상태와 `nextAttemptAt`을 기록하고 `repository-provision.failure.ts`로 provider failure의 retry 가능성을 분류한다.
- `repository-provision.github.ts`의 find-or-create와 `repository-name.ts`의 결정적 이름/ownership marker를 우회하지 않는다.
- OWN enrollment는 current consent를 검증해 collection queue에 편입하며 신청 승인 outbox와 합치지 않는다.
- `RepositoriesService.publish`는 review gate 뒤 GitHub provider 전환을 먼저 시도하고 private-only CAS를 수행한다.
  CAS winner만 local 공개 상태와 `REPOSITORY_PUBLISHED` audit을 커밋한다.

## 수집 흐름

- `CollectionSyncService`가 collection fact의 유일한 live writer다; scheduler/admin trigger는 run을 시작하고 즉시 응답한다.
- `collection-provider-queue.ts`의 queue/rate invariant는 org/external REST sync runtime에 적용한다.
  public discovery/person GraphQL client의 direct fetch까지 queue를 지난다고 가정하지 않는다.
- installation-token REST reconciliation은 조직 repository inventory/presence authority다.
  팀 연결 commit attribution은 installation-token GraphQL stream을 사용할 수 있다.
- complete inventory만 presence/visibility를 바꾸고 한 repository stream 실패가 다른 repository 수집을 중단시키지 않게 backoff 상태를 남긴다.
- person-axis는 `GithubUserActivityHistory`, repository-axis는 `Contribution`이 원본이며 둘을 합치거나 seed/수동 write하지 않는다.
- public discovery/detail은 `CollectionPublicTokenProvider`를 사용하고 private repository를 discovery에서 제외한다.

## 진입점과 검증

- 구현: `repositories.module.ts`, `collection.module.ts`, `repository-provision.worker.ts`, `service/repositories.service.ts`, `collection-sync.service.ts`, `collection-scheduler.service.ts`.
- unit: `repository-provision.worker.spec.ts`, `repositories.module.spec.ts`, `collection-sync.service.spec.ts`, `collection-provider-queue.spec.ts`.
- integration: `repository-provision.worker.integration.spec.ts`, `repository-outbox.consumer.integration.spec.ts`, `repositories.repository.integration.spec.ts`, `collection-scheduler.integration.spec.ts`, `github-user-activity-history.integration.spec.ts`.
<!-- /init:managed id=craft-init-4-github -->
