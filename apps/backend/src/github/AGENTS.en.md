# github — Provisioning and Activity Collection

[한국어](AGENTS.md) | **English**

English translation of the [Korean source](AGENTS.md).
The Korean document remains authoritative.

## Separation of authority

- Repository provisioning/publication in `RepositoriesModule` and activity collection in `CollectionModule` share a directory but have different credential and quota authorities.
- Approved repository creation uses the Operations GitHub App, organization collection uses the Collection GitHub App, and external public/person reads use the public-read PAT.
  Do not use one authority's credentials or rate budget as a fallback for another.
- Do not expose secrets, installation tokens, lease owners, or private repository facts in logs, errors, or public responses.

## Provisioning and publication

- `service/repository-outbox.consumer.ts` claims approval events using leases and `SKIP LOCKED`, and the scheduler polls `service/repository-provision.worker.ts`.
- The worker records durable job state and `nextAttemptAt`, and classifies whether provider failures are retryable through `domain/repository-provision.failure.ts`.
- Do not bypass find-or-create in `service/repository-provision.github.ts` or deterministic names/ownership markers in `domain/repository-name.ts`.
- Reuse the pure rules in `domain/github-repository-url.ts` to parse repository URLs.
- OWN enrollment verifies current consent before joining the collection queue; do not combine it with the application approval outbox.
- `RepositoriesService.publish` first attempts the GitHub provider transition after the review gate, then performs a private-only CAS.
  Only the CAS winner commits local public state and the `REPOSITORY_PUBLISHED` audit.

## Collection flow

- `CollectionSyncService` coordinates sweep lifecycle and stream collection, `CollectionInventory` owns inventory observations, and `CollectionStreamCheckpoint` owns atomic persistence of facts/frontiers.
  Scheduler/admin triggers start runs through `CollectionSweepRunner` and respond immediately.
- The queue/rate invariants in `gateway/collection-provider-queue.ts` apply to the org/external REST sync runtime.
  Do not assume that direct fetches by public discovery/person GraphQL clients pass through the queue.
- Installation-token REST reconciliation is the authority for organization repository inventory/presence.
  Commit attribution for team-linked repositories may use installation-token GraphQL streams.
- Only complete inventories change presence/visibility; leave backoff state so that one repository stream failure does not stop collection for other repositories.
- `GithubUserActivityHistory` is authoritative for the person axis and `Contribution` for the repository axis; do not combine them or write to them through seeds/manual writes.
- Public discovery/detail uses `CollectionPublicTokenProvider` and excludes private repositories from discovery.

## Entry points and verification

- Implementation: `repositories.module.ts`, `collection.module.ts`, `service/repository-provision.worker.ts`, `service/repositories.service.ts`, `service/repositories-read.service.ts`, `service/collection-sync.service.ts`, `service/collection-trigger.service.ts`, `job/collection.scheduler.ts`.
- Unit: `service/repository-provision.worker.spec.ts`, `repositories.module.spec.ts`, `service/collection-sync.service.spec.ts`, `gateway/collection-provider-queue.spec.ts`.
- Integration: `service/repository-provision.worker.integration.spec.ts`, `service/repository-outbox.consumer.integration.spec.ts`, `repository/repositories.repository.integration.spec.ts`, `job/collection-scheduler.integration.spec.ts`, `repository/github-user-activity-history.integration.spec.ts`.
