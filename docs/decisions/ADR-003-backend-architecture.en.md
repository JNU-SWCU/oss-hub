---
slug: ADR-003-backend-architecture
date: 2026-07-11
author: GoBeromsu
status: Accepted
references:
  - ADR-001-테크스택
refines: []
---

# ADR-003: Backend Architecture

[한국어](ADR-003-backend-architecture.md) | **English**

English translation of the [Korean source](ADR-003-backend-architecture.md).
The Korean document remains authoritative.

## Status

Accepted

The 2026-10-08 amendment approves the backend layering conventions in §10 below; it does not mean migration of all code is complete.
Implementation status and verification evidence are tracked in [#1478](https://github.com/JNU-SWCU/oss-hub/issues/1478) and linked PRs.
§10 supersedes the injection-key/Port rules in the earlier DEC-42 and [ADR-010](ADR-010-contribution-tracking-context.en.md) §7, and the folder rules in §8.

> **2026-08-20 amendment — removal of `COLLECTION_READ_PORT`.**
> This amendment abolishes the in-process Port that DEC-42 placed in front of reads from the same DB.
> The Decision below is current.
> The DEC-42 wording immediately before its abolition remains in the 2026-08-20 Changelog.
>
> **Follow-up the same day — no cross-module Service hops.**
> `RankingService.findPublicActivity` was a one-line `return this.ranking.findMetrics(query)`.
> This is the same antipattern as moving a Port into a Service.
> staff-insights reads through its own Repository.

## Date

2026-07-11

## Context

The NestJS backend must preserve discoverability and dependency direction as features grow.
API input validation, domain-error conversion, and transaction boundaries for data changes need consistent handling.
Too many abstraction layers early on would make implementation and review costs exceed actual complexity.

DEC-42 collected same-DB queries in the collection module behind `COLLECTION_READ_PORT`.
In practice, `CollectionReadService.getPublicRankingMetrics` was a one-line hop: `return this.publicRanking.findMetrics(query)`.
That Port used Fowler's Gateway as an in-process query bus, and the hop was a pass-through overlapping the Service Layer.
It also came with per-table Repositories (Table Data Gateway / legacy DAL) and the practice of prohibiting query JOINs through write-Repository rules.

The same antipattern reappeared in a Service after the Port was removed.
`RankingService.findPublicActivity` was `return this.ranking.findMetrics(query)` for insights to call.
Fowler's Service Layer is its own use-case boundary, not another screen's same-DB query bus.
Borrowing the ranking question for insights because the underlying activity table is the same is Table Data Gateway/repository-per-table — the pattern Microsoft Learn's persistence-layer guidance prohibits.

## Decision

Use feature-module folders as the backend's top-level units.
Within each module, use a one-way layered Controller → Service → Repository structure.
Keep Prisma DB access only in repositories and `prisma/`; enum imports and composition/test exceptions follow §10.
As Fowler's Service Layer, the Service owns use cases and transactions (Unit of Work) and does not expose HTTP transport types or Prisma models.
Controllers own HTTP input validation, request DTO → domain command conversion, guards/headers/status, and response DTO conversion; they do not own DB access or business rules.
Repositories own persistence access and persistence DTOs and do not leak Prisma rows beyond their layer.
Separate DTOs from domain models.

A global NestJS exception filter converts exceptions into API error responses.
The Service Layer owns transaction start, completion, and failure handling for every data-changing use case.
Controller↔Service and Service↔Repository contracts use explicit commands/queries/results; do not create a Port between Controller and Service.
Do not introduce ports, adapters, or additional abstractions without a functional requirement.
A one-line hop is not orchestration.

Place external-system calls (such as GitHub HTTP) in gateways within the module.
Do not put alias injection keys or a separate Port layer before same-DB access.
Cross-module use-case/feature reuse follows the service boundary in §10, but another module's Service must not be used as a simple same-DB query bus.
Do not restore the abolished `COLLECTION_READ_PORT` or `RankingService.findPublicActivity`.
`StaffInsightsRepository` owns staff-insights activity queries.
Layer-respecting delegation such as `listYears`, called by its own module's Controller, is not a hop.

A read Repository answers one screen question, not one table.
Fowler's Repository is a collection-like interface to a set of objects, not a Table Data Gateway/legacy DAL with one repository per table.
Microsoft Learn's persistence-layer guidance also prohibits repository-per-table.
Queries may JOIN under Meyer/Fowler Command Query Separation and Microsoft Learn CQS/CQRS.
Do not prohibit read joins by applying write-Repository rules unchanged to reads.

`github` does not reverse-import consumer modules.
Consumer Services do not import concrete `github` repositories.
Consumer Repositories use Prisma directly.

`GET /ranking` is public to everyone.
A STUDENT session is equivalent to anonymous access.
Public entries contain only four fields: `rank`, `githubLogin`, `commitCount`, and `pullRequestCount`.
Page metadata `dataAsOf` and `nextCycleAt` are public, but `displayName`, `name`, `department`, and issue/repository/star/total aggregates are not returned.
Only ACTIVE Staff/Admin sessions (`viewerClass` staff) receive rich entries and CSV.
The ranking response DTO and its regression tests are the SSoT for the running wire contract.

Strict reads of private data by public endpoints are allowed only in owner-approved dedicated public query repositories.
These repositories require explicit selects, public DTO allowlists, service allowlists, identical 404s for private and nonexistent resources, and selector/integration review evidence.
Direct Prisma access by Controllers and ordinary Services, arbitrary private joins, wildcard includes, redact-later approaches, and fetching forbidden fields are prohibited.

### 10. Backend layering convention amendment

#### 10.1 Folder and import boundaries

Adopt Domain-first + Layered as the target structure for all backend business modules.
The permitted layer folders within a business module are limited to `controller/ service/ repository/ gateway/ job/ dto/ domain/`; do not create empty folders.
Nested `programs/archive/<feature>/` follows the same layer rules.
Module roots contain only explicitly classified files for module composition, configuration, injection keys, error codes, types, and their adjacent tests.
Module-root contract files reference only their own module-root contracts, domain, runtime-config, and Prisma-based types.
Authentication guards belong to the controller layer; do not create a separate business-authorization guard layer.
`common/`, `runtime-config/`, and `prisma/` are shared foundation modules; `storage` and `auth` are reusable feature modules.
Do not put business rules in `common/`; move business-specific pure logic into the owning module's `domain/`.

| Source | Allowed targets |
| --- | --- |
| controller, job | service, own module's dto, domain, auth authentication guards/AuthenticatedRequest, common |
| service | own repository/gateway, domain/service of all modules, storage, runtime-config, common |
| repository | own module's repository, domain of all modules, Prisma-based functionality, common |
| gateway | domain, external SDKs, common |
| dto | domain, common |
| domain | domain, including other modules' domain, common |
| common | common |
| composition, test | own module internals, other modules' module files/services, and explicit test exceptions |

Deny layer dependencies not in the table by default; every layer may use common.
Direct imports of another module's repository, gateway, or dto are prohibited.
Service-to-service dependencies are allowed only for use-case/policy reuse, not circular dependencies or one-line query forwarding.
Gateways own external calls, jobs own Cron/Interval/CLI entry points, and services own executable business behavior.
Services do not call jobs, and jobs do not call repositories directly.
Put `*Dto` declarations in dto and prevent production code from importing tests/fixtures.
Preserve HTTP input DTO runtime classes and decorator metadata.
Services/domains do not import HTTP DTOs; they use domain commands/queries/results, while DTO presenters own date, URL, and public-allowlist conversions.
Response contracts may also use explicit interfaces.

#### 10.2 Injection keys and S4/S5 judgments

Default to concrete-class injection; use injection keys only at interface/object/function boundaries.
Keep boundaries such as `MAIL_SENDER`, `OBJECT_STORAGE`, `RUNTIME_CONFIG`, and clocks, but prohibit `useExisting` aliases that merely give a class a second name.
Nest built-in keys `APP_GUARD`, `APP_FILTER`, `APP_INTERCEPTOR`, and `APP_PIPE` are exceptions only for global registration of cross-cutting infrastructure.
`AuthenticationGuard` registered through `APP_GUARD` falls within this exception.
Remove alias injection keys for same-DB services; modules export narrow service classes.
A Port is neither a folder nor an independent layer.

The S4 investigation found that `ProgramEditorRepositoryPort` and `AuditLogRepositoryPort` duplicate contracts with single implementations.
Replace them with `Pick` / `jest.Mocked` contracts derived from concrete classes while preserving generic transaction fixture semantics.
S5 found stateful fakes and E2E overrides for the GitHub client, so retain concrete-class DI and introduce no new interface.
The missing `revokeCollaborator` contract in the fake must be checked and completed during the owning module's migration; this decision does not claim that completion or verification has happened.
The existence of test doubles does not justify duplicate same-DB injection keys or a separate Port layer.

#### 10.3 Allowed Prisma enum usage

DB-access symbols `PrismaClient`, `PrismaService`, transaction clients, the `Prisma` namespace, and `Prisma.sql` belong only in repositories and `prisma/`.
Business-layer `@prisma/client` imports use a positive allowlist containing only enum names declared in the schema.
This also applies to domain; `Prisma`, model types, `PrismaPromise`, and default/namespace imports are not allowed.
Enum aliases and type-only imports are allowed, but type-only model imports are rejected.
Prevent bypass through re-exports, require, or dynamic imports.
Module composition, tests/fixtures/support, and Prisma seeds are explicitly classified exceptions, not exceptions permitting DB access in ordinary services or guards.

`scripts/prisma-enum-names.mjs` deterministically extracts enum declarations from `schema.prisma` and exports `prismaEnumNames`.
Loading ESLint configuration must not require the generated client as a runtime dependency.
A separate test compares this list to `$Enums` in the generated client.
This amendment changes neither enum values nor the DB schema.

#### 10.4 Lock order and S6 decision

The sole execution entry point for tree locking is `lockProgramTree(tx, step)` in `prisma/lock-program-tree.ts`, imported only by repositories and tests.
Do not export individual Program, Milestone, or document lock helpers.
Steps follow Program → Milestone → MilestoneDocument order, with documents locked by ascending id.
Do not add a new Program lock to existing milestone-only flows that do not lock Program.
The program/milestone steps return null for missing rows; later steps connect through the preceding step's opaque witness.
The document step distinguishes `DOCUMENT` and `ALL` and does not reacquire earlier locks.
Per-transaction state and witnesses reject repeated steps, reverse order, and witnesses from other transactions.
Callers preserve the existing placement and semantics of queries between steps, programId checks, null handling, and projections.
Do not merge repository-local single-document locks into this tree helper.

S6 identified `updateMilestoneEdit` locking the same tree twice within one transaction, before and after a write.
Approved option A retains the prohibition on relocking within a transaction and replaces the second post-write `lockMilestoneEdit` with a lock-free reread in that same transaction.
Only removal of this duplicate locking SQL was approved; preserve response fields, read order, null handling, and behavior on programId mismatch.
Apply the same principle to other duplicate locks, but stop migration and obtain another decision if responses change.
Verify per-call SQL order, arguments, early returns, and concurrent-transaction behavior through characterization; use semantic diagnostics from `ts.createProgram` to verify type witnesses.

#### 10.5 Authentication/authorization and S7/S8 decisions

Under S7, retain both `AuthenticationGuard` and `SessionGuard`.
The former handles global default authentication and public/optional-session exceptions; the latter expresses explicit session requirements on routes.
Do not delete one in this migration merely because their roles overlap.
Keep the Origin checks in `OriginGuard` as well.

Services perform business-authorization checks through `UsersAuthorityService`; users repositories own user lookup.
Controllers in other modules may import authentication guards and the `AuthConfig` exported by AuthModule to inspect session-cookie attributes.
`assertActiveStaff` and `assertAdmin` accept the calling module's error-construction contract to preserve existing module codes, messages, and bodies.
Do not arbitrarily combine the active/staff/admin policies of existing guards.
Board services/repositories own board participation eligibility and reuse the users authority service only for staff judgments.
The authorization guards to migrate are six files: applications-staff, milestone-documents-staff, program-teams-staff, submission-reviews-staff, collection-admin, and board-access; also remove the applications list-only subclass.

In S8's board HTTP probe, an unauthorized actor's invalid body/query changed its first error from `403 BRD_001` to `400 SYS_003`; invalid/missing Origin changed it from `403 BRD_001` to `403 AUT_002`.
This is evidence of ordering changes when moving from guards to services, not proof that all modules have been verified.
Approved option B retains guard removal and accepts validation or Origin errors preceding business-authorization errors for unauthorized actors with invalid body/query/params/Origin.
Do not change valid-request status, module error code, message, response body, or the anonymous-authentication contract.
Each authorization migration PR must explicitly state this precedence change and update new-order characterization alongside backend/E2E/frontend checks relying on the previous 403-first assumption.
Do not delay validation or disguise the former order through a separate interceptor.

#### 10.6 Storage feature boundary

`storage` is a shared feature module providing `put/get/delete`, with `OBJECT_STORAGE` bound through `useClass` to a concrete adapter.
Object-key and filename policies belong to the owning business domain; do not put program/submission business rules in storage.
Distinguish object-listing capability from upload/download APIs; orphan-object decisions and DB-reference lookup belong to the owning business module.
Preserve existing env keys, error strings, object keys, and CLI contracts.
E2E uses explicit storage doubles and never connects to actual managed R2.

#### 10.7 Enforcement and trust boundary

Both apps share type-aware lint and no-comments rules while retaining app-specific runtime/framework rules.
Enforce backend layering through `eslint-plugin-boundaries`, cycle checks, the enum positive allowlist, and injection-key/DTO/test-boundary checks.
Do not conceal incompatibility in the boundaries tool with an arbitrary substitute implementation.
Cycle checking reports the dpdm graph as lint errors.
Prohibit production type-position `import()` and `import x = require()` where dpdm cannot collect edges; prohibit `@dpdm-ignore` everywhere.
Treat unresolved internal dependencies as check failures, not evidence of no cycles.
Because no files remain unclassified, production dependencies on unclassified files are also checked under layering policy and denied by default.
Jobs serving as executable CLI entry points may import app bootstrap and runtime configuration.
Knip detects unused code from explicit runtime, CLI, seed, and test entry points.
Handle findings caused by Nest DI/decorators with justified entries/configuration, not broad ignore rules.

Rails rules are ordinary lint errors applied by each app's `eslint.config.mjs`; lint baselines and the lint ratchet were retired in P7.
The legacy module-zone rule was also retired; its unique constraints are owned by boundaries policy and fixtures in `apps/backend/test/architecture/boundaries.eslint.spec.ts`.
Knip budgets and the Knip ratchet were retired in P7 as well; Knip is an ordinary check that fails on any finding.
Without budget or predecessor comparisons, PRs and main pushes run the same `pnpm lint:structure` (`knip`) without an event SHA input.
Root `pnpm lint` runs application lint including rails and Knip; required CI runs the same contract through app-lint steps and a separate Knip step.
Changes to `knip.json` select the rails lane; contract tests fix the Knip-step invocation and root lint script.

Handle uses Knip cannot see statically only through workspace-specific `ignoreDependencies` in `knip.json`, not file-level `ignore` entries.
`pretendard` in `apps/frontend` is referenced only through font file paths in `next/font/local` `localFont`, which Knip cannot recognize as usage.
Root and `apps/frontend` deliberately read the backend-installed generated `@prisma/client` through `createRequire` based on `apps/backend/package.json`, so do not add it as a root/frontend dependency.
Add new ignore entries only with equivalent justification documented here.

Knip runs with PR-head configuration and therefore does not prevent tampering with `knip.json` itself.
Mitigate this residual risk through required CI path selection, invocation contract tests, and configuration-diff review; do not claim equivalence to trusted-code execution.

#### 10.8 Distinguishing decisions from implementation

Accepted status here approves the target structure and explicit S6/S8 exceptions, not completion of every module's migration.
Rails were introduced with baselines reduced through module-by-module migration; the lint baseline and Knip budget were retired as described in §10.7.
Record completion only in linked Issues/PRs with actually executed verification; do not duplicate a progress ledger in this ADR.
Schema changes, required AppModule changes, unapproved API changes, and lock-response changes require separate decisions.

Follow-up F1 considers enum/state simplification and domain-owned enums under a separate migration plan; it is not executed in this amendment.
Follow-up F3 considers simplifying SessionGuard after a route manifest proves authentication-contract preservation; retain both authentication guards for now.
Follow-up F4 considers declarative transaction propagation such as `@nestjs-cls/transactional` and version-column optimistic locking; library adoption, columns, and migrations are outside this scope.
Track the trackType idempotency-hash issue separately in [#1477](https://github.com/JNU-SWCU/oss-hub/issues/1477), not as part of this layering amendment.

## Alternatives considered

### Top-level layer folders

- Pros: All controller, service, or repository files can be viewed together by type.
- Cons: Understanding one feature requires moving across top-level folders and reduces feature cohesion.
- **Rejected:** Feature-module folders align change units with navigation units, improving maintainability.

### Clean architecture

- Pros: Emphasizes dependency inversion and high replaceability.
- Cons: Team14_BE experience produced more layers than actual requirements warranted, increasing cognitive load and implementation cost.
- **Rejected:** At the current scale, layering within modules provides necessary separation without excessive layers.

### Keep `COLLECTION_READ_PORT`

- Pros: Consumers do not see github tables directly.
- Cons: A Gateway for same-DB queries becomes an in-process query bus; one-line hops overlap the Service Layer.
- **Rejected:** This work required removing the Port and migrating consumers.

### Migrate only ranking and leave programs/system-status for a later PR

- Pros: Smaller change in this PR.
- Cons: The same incorrect Port remains for other consumers.
- **Rejected:** This work required removing the Port and migrating every consumer.

### Reuse RankingService.findPublicActivity from staff-insights

- Pros: Fold code stays in one place.
- Cons: A one-line hop again turns the Service Layer into a query bus.
  Ranking's question (ranking rows for all registered users) and insights' question (the ACTIVE student cohort) differ; sharing because tables match is Table Data Gateway/repository-per-table.
- **Rejected:** Give each screen question its own Repository.
  Two copies of the fold are an accepted cost.

## Consequences

### Enables

- Navigate controllers, services, repositories, DTOs, and domain code together by feature.
- Clarify ownership of per-use-case transaction boundaries and error conversion.
- Separate change impact across HTTP, business rules, and persistence.
- Screen-question read Repositories own same-DB JOINs.
- staff-insights reads the same activity tables through its own Repository, with no ranking Service hop.

### Costs / trade-offs

- Reviews must continually verify one-way dependencies and DTO/domain separation.
- Reevaluate further separation if highly complex external integrations arise.
- Same-DB queries are spread across multiple consumer Repositories.

### New constraints

- Controllers do not access repositories without going through services.
- Distinguish Prisma DB access from enum imports under §10.3.
- Repositories do not own business rules or HTTP representations.
- Services are Fowler Service Layers; one-line hops do not count as orchestration.
  Do not use another module's Service as a same-DB query bus.
- Gateways and injection keys follow §10.1/§10.2; do not place alias Ports before same-DB reads.
- staff-insights does not call RankingService.
  `StaffInsightsRepository` reads activity, years, and as-of time.
- Read Repositories answer one screen question, not one table.
- `github` does not reverse-import consumer modules.
  Consumer Services do not import concrete github repositories.
- Only public query repositories perform public reads with explicit selects within owner-approved strict-read allowlist boundaries.
- Controllers and ordinary services do not access the DB directly through Prisma; private joins are prohibited outside dedicated public query repositories.
- Services own transaction boundaries; do not create individual response formats bypassing the global exception filter.
- NestJS sets the API prefix through `setGlobalPrefix('api/v1')`.
- Rewrite eslint DEC-42 to match this decision.
- Move CollectionReadService reads to consumer Repositories — RankingRepository (`ranking/`), ProgramActivityRepository/ProgramMetricsRepository (`programs/`), and SystemStatusRepository.
  `collection-schedule.ts` shares the next collection tick.
- `GET /ranking` is public to everyone; STUDENT is equivalent to anonymous.
  Public entries contain only rank, GitHub login, commits, and PRs, with public collection-time metadata.
  Only staff receive real names, departments, additional aggregates, and CSV.

## Changelog

- 2026-10-11: Retired Knip budgets and the Knip ratchet in P7, making Knip an ordinary failing check with a zero-finding requirement.
  Workspace-specific ignore justifications for `pretendard` and `@prisma/client` are in §10.7.
- 2026-10-11: Retired the lint ratchet and legacy module-zone rules in P7, making rails, unclassified-target checks, and cross-module dto-import prohibitions application lint errors.
- 2026-10-08: Consolidated decisions on closed layer folders, injection keys, Prisma enum allowances, staged locking, authentication/authorization separation, storage, and trusted-SHA rails into §10.
  Recorded S6's post-write lock-free reread and S8's validation/Origin-first errors as approved changes, distinguishing S4/S5/S7 investigation judgments and unexecuted F1/F3/F4 follow-ups.
  Supersedes ADR-010 §7/§8 structural rules and distinguishes Accepted status from migration of all code.
- 2026-08-25: Named the deployed ranking response DTO as wire-contract SSoT and aligned public/STUDENT entries to four fields: `rank`, `githubLogin`, `commitCount`, and `pullRequestCount`.
  Removed the prior statement that departments are public to everyone and recorded ACTIVE staff/admin rich entries and public page metadata boundaries (#1027).
- 2026-07-11: initial decision
- 2026-07-31: Limited public strict reads to dedicated allowlist repositories and documented Controller→Service→Repository DTOs and Port-only cross-module/external behavioral dependencies.
- 2026-08-04: Amended DEC-42 (the collection module's `COLLECTION_READ_PORT`-only consumer boundary) to clarify that even with two collection sources, `ORG_PROVISIONED` and `EXTERNAL_PUBLIC`, the collection service layer absorbs differences in credentials/discovery; the Port boundary and delegate-access rules themselves are unchanged.
  This was the first explicit `DEC-42` identifier in this document — previously, `eslint.config.mjs`, tests, and `AGENTS.md` cited “ADR-003 DEC-42” without that identifier appearing in the ADR body, making traceability indirect.
- 2026-08-09: Amended DEC-42's “do not create new Ports” constraint through [ADR-010](ADR-010-contribution-tracking-context.en.md) §7.
  Three contribution-tracking ports plus a separately listed provisioning port became allowed; the Port boundary and prohibition on direct delegate access themselves remained unchanged.
- 2026-08-20: Removed `COLLECTION_READ_PORT` and moved same-DB queries into consumer Repositories.
  Rewrote eslint DEC-42.
  CollectionReadService queries moved to RankingRepository, ProgramActivityRepository, ProgramMetricsRepository, and SystemStatusRepository; staff-insights reads the same activity tables through its own Repository.
  Removed the `RankingService.findPublicActivity` hop the same day.
  Like the Port, it used Fowler's Service Layer as an in-process query bus; borrowing the ranking question for insights because the tables matched was Table Data Gateway/repository-per-table.
  Immediately before abolition, DEC-42 read: “The collection module's cross-module public surface is only the `COLLECTION_READ_PORT` token and `CollectionReadPort` (DEC-42); consumer modules (`programs`/`ranking`/`system-status`, and others) do not reference concrete implementations or Prisma delegates directly.
  Collection has two sources: `ORG_PROVISIONED` (organization repositories) and `EXTERNAL_PUBLIC` (public repositories outside the organization registered by students).
  They differ only in credentials and repository-list discovery; repository metadata/commit/PR/release collection, cursors/frontiers, fact persistence, yearly aggregates, leases, and transport queues are shared regardless of source.
  Choosing the collection strategy for a source belongs to the collection service layer; this branch neither adds a Port to `COLLECTION_READ_PORT` nor expands the tables exposed to consumers — the Port boundary itself and its single delegate-access rule (DEC-42) do not change with this extension.
  DEC-42's ‘do not create new Ports’ constraint was amended by [ADR-010](ADR-010-contribution-tracking-context.en.md) §7.
  The contribution-tracking context exposes three ports — contribution aggregation, public eligibility, and health — and separately lists the provisioning port (`REPOSITORIES_READ_PORT`), because all four answer different questions, change at different rates, and serve different consumers.
  The Port boundary itself and its single delegate-access rule remain unchanged; only the constraint that there must be one port changed.”
  Earlier Changelog entries dated 2026-08-04 and 2026-08-09 refer to that wording's history.

## References

- [Fowler, Patterns of Enterprise Application Architecture — Repository](https://martinfowler.com/eaaCatalog/repository.html)
- [Fowler, Patterns of Enterprise Application Architecture — Service Layer](https://martinfowler.com/eaaCatalog/serviceLayer.html)
- [Fowler, Patterns of Enterprise Application Architecture — Gateway](https://martinfowler.com/eaaCatalog/gateway.html)
- [Fowler, Patterns of Enterprise Application Architecture — Unit of Work](https://martinfowler.com/eaaCatalog/unitOfWork.html)
- [Fowler, Patterns of Enterprise Application Architecture — Table Data Gateway](https://martinfowler.com/eaaCatalog/tableDataGateway.html)
- [Fowler, Command Query Separation](https://martinfowler.com/bliki/CommandQuerySeparation.html)
- [Microsoft Learn: Designing the infrastructure persistence layer](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/infrastructure-persistence-layer-design)
- [NestJS Modules](https://docs.nestjs.com/modules)
- [NestJS Exception Filters](https://docs.nestjs.com/exception-filters)
- [ADR-004: REST API Specification](ADR-004-REST-API-규격.en.md)
