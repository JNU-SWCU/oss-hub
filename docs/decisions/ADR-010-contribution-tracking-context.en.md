---
slug: ADR-010-contribution-tracking-context
date: 2026-08-09
author: GoBeromsu
status: Accepted
references:
  - ADR-003
  - ADR-006
  - ADR-009
  - ADR-011
refines:
  - ADR-006
  - ADR-009
---

# ADR-010: Contribution Tracking Context — Two Read Surfaces and Their Data Sources

[한국어](ADR-010-contribution-tracking-context.md) | **English**

English translation of the [Korean source](ADR-010-contribution-tracking-context.md).
The Korean document remains authoritative.

## Status

Accepted

The 2026-10-08 amendment abolishes the Port/injection-key policy in §7 and consolidates the layering conventions in §8 into [ADR-003](ADR-003-backend-architecture.en.md) §10.
The remaining contribution-tracking data-source decisions in this ADR remain in force; approving the structural decision does not mean all code has been migrated.

> **2026-08-12 amendment**: Phase D of `#617` consolidated `Repository` into `GithubRepository`.
> Parts of this document describing `Repository` as a separate provisioning table (§6 and others) now refer to `applicationId`/`programId`/`teamId`/`publishedAt` columns in `GithubRepository`.
> The body is preserved as a decision record; only this note is added.

> **2026-08-19 amendment — each dimension has its own acquisition.**
> The body of §1–§4 below records the period when both screens read the same `Contribution` table.
> Rather than delete that account, this note adds the currently established shape.
> See **[2026-08-19 amendment — acquisition for two dimensions and five ranking metrics](#2026-08-19-amendment--acquisition-for-two-dimensions-and-five-ranking-metrics)** below.

## Date

2026-08-09

## Context

The platform needs to show students two things.

1. **Ranking** — how active this student has been **this year**, with past years selectable.
2. **Program** — how much this student contributed to **their team repository**.

These screens fold the same facts differently and have long shared one data source.
Operational findings challenged that premise.

**The starting hypothesis was “ranking stopped.” Production diagnosis overturned it.**

Hourly sweeps are healthy, with no errors, and the public API exactly matches the DB.
Slow-looking growth was not a malfunction but a **coverage gap** — only three repositories were tracked (organization repositories), with zero `EXTERNAL_PUBLIC` repositories.
Comparison against GitHub shows accurate figures for students focused on organization repositories, but partial capture of students working elsewhere.

However, the structural finding remains: **ranking depends on organization-repository sweep health, so a stopped sweep also stops the student's screen.**

At the same time, `ADR-009` has already decided that activity in an outside-organization repository connected through `OWN` in an application **counts toward program performance**.
Current collection also already mixes contributions to external public repositories into ranking (`getPublicRankingMetrics` in `collection-read.service.ts`).

The collection structure was split across three places: two GitHub App clients (`repositories/github-app.client.ts`, 205 lines; `collection/collection-app.client.ts`, 1030 lines), three token providers, and three modules touching octokit (`auth`, `collection`, `repositories`).
Rate limits are account-wide, yet each client knows only its own usage; two pacing queues cannot provide coherent pacing.

## Decision

### 1. Separate data sources for the two screens

```text
① Ranking   My activity this year     commits/PRs ← contributionsCollection (GraphQL, 1 call per student)
                                     releases    ← add ② collection values; 0 if absent
② Program   My team-repo contributions Contribution (repositoryId, githubId, date) ← organization App sweep
```

**Four reasons.**

1. The deployed ranking screen already states that it aggregates **public** GitHub activity connected to OSS Hub.
   Public-activity scope is an existing user promise, not new policy.
2. `contributionsCollection` directly answers “this student's activity this year,” requiring one call per student rather than scanning repositories.
3. Moving ① to `contributionsCollection` separates it from sweeps, leases, cursors, inventory, and installation tokens.
   **It has not moved yet** — ① currently reads the same `Contribution` as ②, so ranking stops when collection stops.
   This rationale describes a target, not a current property (see Follow-ups).
4. Including private organization contributions in public ranking reveals that a person did substantial private work even without naming the repository.
   Excluding them from the public surface aligns both the disclosure boundary and screen wording.

**Why the alternative of keeping one data source was rejected.**
Its benefits (including releases and organization-private activity) can be supplied by items 3 and 5 below, but its drawbacks (continued dependence on sweep health and formally endorsing disclosure through policy) cannot be replaced.

This section also defines ranking's **current-year** default when `?year=` is absent.
[ADR-011](ADR-011-query-filter-type-boundary.en.md) is authoritative for the type in which that value reaches persistence — do not send `"all"` and `"2026"` into SQL as the same string.
The faculty/staff student-activity screen's absent default (all time) does not copy ranking; it is ADR-011 Decision 5.

### 2. Ranking filters operate on the person dimension

Whose activity ranking counts (aggregation) and whom it shows (display) are different questions; this section distinguishes them.

**Aggregation — whose activity is counted.**
Count registered students' activity.
Do not filter on the repository dimension (`Application` linkage).

Failing closed on repository linkage would erase the current ranking entirely, because its dominant source is organization repositories without `Application` records, including `oss-hub` itself (`collection-sync.service.ts`).
Filtering by person (`githubId ∈ User`) removes only third parties while preserving registered students' activity.

**Display — who appears on screen.**
Show every registered user.
Even zero-contribution users remain visible as 0/0/0 (PM decision, 2026-08-11) — unlike aggregation, which defines inputs to the sum, display separately keeps users whose result is zero.

**Repository scope — which repositories' activity is counted.**
Include every JNU-SWCU Org repository regardless of visibility (PM decision, 2026-08-11).
Personal accounts outside the organization still contribute only public repositories (§5).
Including private-organization activity in public ranking numbers is separate from publishing the repository itself — publication still requires the explicit publish action by an authorized operator under `ADR-006` and `docs/rules/security.md`.

Program scope (`Application`/`Team` linkage) applies only to screen ②.

### 3. The total is commits + PRs + releases

Retain `D7`.
With no weights, the name is activity count, not score.

`contributionsCollection` does not count releases — GitHub's five contribution types are commits, issues, PRs, PR reviews, and repository creation; releases are not among them.
When moving ① to GraphQL, retrieve commits/PRs there and **add releases from ② collection, using 0 when absent**.

**The current implementation precedes that stage.**
① also reads the same `Contribution` as ②, so all three values come from sweeps.

Do not count `issue` or `PR review`.
Consequently, **our numbers may differ from the student's GitHub profile graph** — GitHub counts issues/reviews; we count releases.
Screen copy explains this distinction.

Do **not** adopt `D7b`'s proposed rename of `total` to `activityCount`.
Keep the envelope field named `total`.

### 4. Collection granularity is `(repositoryId, githubId, date)`

Store ② data in one `Contribution` table, with `@@id([repositoryId, githubId, date])` and fields `commitCount`, `pullRequestCount`, and `releaseCount`.

> **2026-09-24 amendment (#1133)** — added `issueCount`.
> The repository dimension gained issue history (`GithubIssueHistory`); recalculation recounts all four values in touched cells from the three fact tables plus issue history.
> This amendment does not change §3's total definition — screens consuming `issueCount` are follow-up work.
> Because issue-only days now also produce rows, person lists that do not display `issueCount` (team-repository evidence and public-project contributors) exclude people whose commit + PR + release sum is zero over the queried scope (program period or cumulative), avoiding rows showing “0 commits · 0 PRs · 0 releases.”

**Readers still use two paths.**
The four metric queries (`getRepositoryMetrics`, `getContributorMetrics`, and their cumulative counterparts) read `Contribution`, while the activity **timeline** (`findRepositoryActivity`) still reads fact-table relationships directly — it needs individual dated events that aggregate cells cannot reconstruct.
Both paths view the same facts at different granularity.

- Storage has no year concept.
  Reads restrict only by `WHERE date`, so **no new-year rollover job is needed**.
  The old `*YearAggregate` required special handling to safely read zero for the new year on January 1.
- **Do not store ranking numbers.**
  A precomputed ranking table can leave screens showing stale numbers when updates are missed.
- Use only `githubId` as the person identifier, NOT NULL.
  Keep `githubRepositoryId` for repositories so prefixes distinguish people from repositories.
- **Do not retain individual identifiers (`sha`, PR id, release id).**
  Retain aggregate counts only — how much, not what.
  If list screens become necessary, author-scoped GraphQL supplies full history for 1 point, allowing retrospective backfill.

### 5. Collect private and public inside the organization, public only outside

The collection rule is one sentence: **count registered students' contributions inside and outside the organization.**

- Inside the organization: track both private and public.
- Outside the organization: track only public.
- Unregistered people: do not track.
- Records with unknown authors: do not persist.

Continue collecting organization-private contributions and showing them on ② program screens.
**Exclude them only from public ranking.**
`ADR-009` §3 (“external activity counts toward program performance”) remains; this ADR only separates display boundaries into public and authenticated surfaces.

Keep `Repository.source` (`ORG_PROVISIONED` | `EXTERNAL_PUBLIC`) in the schema, but **do not use it as a ranking filter** (item 2 above).

### 6. Creating or connecting a repository starts tracking

The collection target row (`GithubRepository`) has queue fields (`nextRunAt`, default `now()`, `lastSuccessAt`, `failureCount`).
Creating the row immediately makes it due, so there is no separate enrollment step or condition — **row existence is membership**.

**However, provisioning does not yet create that row.**
Provisioning uses `Repository`, collection uses `GithubRepository`, and they are separate models.
`GithubRepository` rows are created only by sweep inventory observations (`recordRepositoryObservation`).
Collection therefore starts **on the next inventory observation**, not immediately after `NEW` creation or `OWN` connection.
Organization repositories are rediscovered on every sweep, causing a one-cycle delay; external repositories are absent from inventory and never enter until manually registered — why `EXTERNAL_PUBLIC` is currently zero and why automatic discovery is needed.

> **2026-09-24 amendment (#1133).**
> The statement above that collection starts on the next inventory observation no longer applies unchanged to repository URL connections/changes.
> Once an actual application repository URL change commits, `CollectionSchedulerService.collectRepository` immediately collects that single repository in a one-shot run (`CollectionSyncService.runRepository`).
> It silently skips without calling GitHub if the repository is not a collection target, not `PRESENT`, has no known default branch yet, or is outside the organization and not public.
> It also yields if a sweep already holds the same scope lease.
> For these skips and a process restart between save and execution, the next inventory observation (regular sweep) still fills collection as described above.

### 7. Abolition of Port/injection-key policy

The Port-count and alias-injection-key policy in this section is abolished as of 2026-10-08.
[ADR-003](ADR-003-backend-architecture.en.md) §10.1/§10.2 is the current rule; do not duplicate it here.
Keep the distinction between business questions — contribution aggregation, public eligibility, health, provisioning, and collection triggers — without requiring a separate alias Port for each.
The responsibility to distinguish result types from internal persistence state also remains.
Old Port names in the Changelog are decision history, not current exports or injection-key inventories.

### 8. Folders are Domain-first + Layered

Retain Domain-first + Layered; consolidate authoritative closed folder sets, import tables, DB-access, authentication, and authorization boundaries into [ADR-003](ADR-003-backend-architecture.en.md) §10.
Its backend-wide target convention replaces the former scope limited to three domains.
Track actual per-module migration and verification in linked Issues/PRs.

### 9. Writes fully recalculate using one set-based SQL statement

Collection uses **full recalculation**.
Incremental accumulation permanently overcounts after force-pushes or PR deletion and cannot self-correct.

Phase 1 clears **only cells touched by this batch** (`deleteMany`) and refills them with one set-based SQL statement (`INSERT … SELECT … GROUP BY … ON CONFLICT DO UPDATE`).
Do not clear the whole repository: one batch touches a much smaller scope, and clearing everything lets intervening reads see empty data.

**Do not loop cell by cell.**
Date granularity means a batch touches activity days × contributors cells, and recalculation runs inside the checkpoint transaction.
A query per cell exceeds Prisma's default 5-second interactive-transaction limit, rolling back fact persistence too, so active repositories fail permanently at the same place every cycle.

**Scope of force-push self-correction.**
Recalculation derives values from fact-table COUNTs, so aggregates decrease when facts decrease.
But **there is not yet a path deleting the facts themselves** — if an upstream-deleted commit remains as a fact, its value remains.
Fact-layer reconciliation is follow-up work.
The use case is the transaction boundary: **I/O outside, writes inside** — if fetch fails, no transaction starts and existing rows remain intact.

Record accompanying observability metrics: the `n_dead_tup`/`n_live_tup` ratio in `pg_stat_user_tables`, `autovacuum_count`, and delta frequency.

**Phase 1 already uses `$executeRaw`.**
The original intent was Prisma-native only — raw SQL loses type safety and introduces a second vocabulary.
But date granularity expanded touched cells to activity days × contributors, with recalculation inside the checkpoint transaction.
Per-cell queries exceed 5 seconds and roll back fact persistence as well.
**Raw SQL was required for correctness, not performance optimization.**

**Phase 2 remains conditional.**
If observations show dead-tuple accumulation, add `WHERE IS DISTINCT FROM` to write only actually changed rows; if delta frequency is high enough, promote it into a change-history table.
There is no evidence yet, so do not build it now.

### 10. Update hourly and display update time

Do not build webhook-based real-time updates (retain `ADR-006` event minimalism).
Instead, **both screens show their last update time**.
The essence of this incident was “it stopped and nobody knew,” so the screen must announce any recurrence first.

> **2026-09-24 amendment (#1133).**
> “Update hourly” is now a default, not an absolute rule.
> After an actual repository URL connection change commits, that one repository is collected in a one-shot immediately after commit without waiting for the hourly sweep.
> This is not a webhook either — it is triggered only by an internal backend call without subscribing to GitHub webhooks, preserving event minimalism.
> If the hourly cron competes with this one-shot for the same scope lease, that scope skips one tick.
> A process restart between save and execution leaves the repository for the next hourly sweep.
> [ADR-006](ADR-006-github-app-integration.en.md)'s Enables amendment is authoritative for triggers and skip conditions.

### 11. Verification is screen-based

The criterion is whether a student sees their own screen and considers it correct.
Open both screens for 3–5 sample students and compare with their GitHub source.
There is no time limit on the comparison period.

`OWN` (`EXTERNAL_PUBLIC`) cannot use the same criterion unchanged because production has zero applications and therefore no sample students to compare.
Until samples exist, the substitute acceptance is **one controlled repository exercised end-to-end in actual production**: verify enrolled `nameWithOwner` is `owner/repo` and `defaultBranch` is real, external sweeps persist facts without failure, the registered-user filter excludes third parties, and current/past-year ranking plus `dataAsOf` reflect collection.
Restore state after verification so a repository without an approved application does not remain in public ranking.

This substitute acceptance ran on `v0.6.47` on 2026-08-10.
Enrollment → external sweep (604 facts, zero failures) → registered-user filter (604 → 61 `Contribution` rows, zero unregistered users) → ranking (current-year total increased, past years gained values for the first time, `dataAsOf` matched the new `lastSuccessAt`) → screen rendering all passed, and production was restored.

Do not compare against old DB numbers — rules changed, so they are not a valid baseline.
Instead, mechanically check all data against four invariants.

1. Zero duplicate `(repositoryId, githubId, date)` keys.
2. Every `githubId` belongs to the registered-user set.
3. Aggregate totals do not exceed fact counts.
4. No negative values — **a proxy for rerun idempotency**.
   Full recalculation produces only COUNT values, so negatives are impossible in principle and indicate a revived incremental-accumulation path.
   Actual PostgreSQL integration specs directly check that running identical inputs twice yields identical values, because running the entire dataset twice is expensive.

## 2026-08-19 amendment — acquisition for two dimensions and five ranking metrics

> This section is an **addition**.
> No sentence in §1–§11 above was deleted.
> Where the accounts differ, **this section is current**, and the text above records the decisions at that earlier time.

### A. The person dimension gets its own acquisition (§1 implementation)

Actually implement the target left in §1 reason 3: moving ① to `contributionsCollection`.
Both dimensions now have **their own acquisition paths and tables**.

```text
① Ranking   Person dimension      GithubUserActivityHistory ← contributionsCollection + repositories(star), GraphQL, cost=1 per student per year
② Program   Repository dimension  Contribution              ← organization/external repository sweep (REST)
```

Ranking no longer depends on repository-sweep health.
Even if the organization sweep stops, person-dimension figures update through their own sweep — the independence §1 described as not yet current is now an actual property.

**They were not combined into one table.**
Their keys differ and cannot be physically merged (the repository dimension requires `repositoryId`), and `Contribution` has no issue/star/repo fields.
[`docs/rules/data-modeling.md`](../rules/data-modeling.en.md) is authoritative for the person-dimension table's shape, naming, and rationale for no FK; do not repeat it here.

### B. Person granularity is `(githubId, year)` (alongside §4)

The repository granularity `(repositoryId, githubId, date)` defined in §4 **remains valid** — screen ② continues to read it.
The person dimension separately has one row per `(githubId, year)`.
Rows accumulate by year, preserving past years without new-year rollover work.
The rest of §4's principles (no stored ranking positions, no retained individual identifiers, and `githubId` as the person identifier) also apply to the person dimension.

### C. Ranking has five metrics; releases belong only to ② (§3 D7 amendment)

§3 retained `D7` (commits + PRs + releases).
**This note amends that part.**
Ranking uses the following five metrics and their simple sum.

| Metric | Source |
| --- | --- |
| `commitCount` | `contributionsCollection.totalCommitContributions` |
| `pullRequestCount` | `contributionsCollection.totalPullRequestContributions` |
| `issueCount` | `contributionsCollection.totalIssueContributions` |
| `repositoryCount` | `contributionsCollection.totalRepositoryContributions` |
| `starCount` | Sum of stargazers from `repositories(ownerAffiliations: OWNER, privacy: PUBLIC)` (**cumulative**) |

`release` becomes **exclusive to ② program screens**.
Because `contributionsCollection` does not count releases, the person dimension has no release field; repository collection remains the sole source.
The §3 proposal to add ② release values, or zero when absent, was not adopted — crossing dimensions to add values would blur the MECE boundary again.
The disappearance of release counts from that screen is intentional.

The envelope field remains `total` as in §3, with no weighting.
Counting `issue` narrows the difference from the GitHub profile graph, but they still differ in period, timezone, and inclusion of stars — screen wording continues to explain this.

**The five-metric composition came from an administrator request** to count stars, repositories worked on, and issues instead of releases.
The **Notion Decision Log** is authoritative for product/planning decisions as specified in [`AGENTS.md` Important Files](../../AGENTS.en.md#important-files).
This ADR does not remake that decision; it records only technical consequences (tables, acquisition paths, and dimension boundaries).

### D. Disclose manipulability

`starCount` and `repositoryCount` are **metrics users can generate themselves**.
Repositories can be created freely, and users can exchange stars.
Commits, PRs, and issues are not completely immune either, but these two are especially inexpensive to manipulate.

Include them nevertheless — ranking displays activity rather than judging a prize competition, and the administrator wanted activity outside our repositories to be visible.
Record that property here: if these numbers later drive an adjudication, weighting or verification must come first.
For the same reason, screen copy must label stars as cumulative.

### E. Correct D15 wording — do not abolish it

Public ranking's display policy (`D15`) **remains**.
Because displayed fields expanded, correct its wording to “`githubLogin` and `department`.”
Real names still do not reach the public surface; under the owner's decision on 2026-08-19 that departments may be public, `department` also appears in the unauthenticated layer.
Read departments through the `resolveCompatibleProfileDepartment` shim, not by directly selecting `User.department`, to prevent users with only `UserProfile` from appearing as all-null values masquerading as zero.

The invariant that the public ranking repository does not read real names remains unchanged.

## Consequences

- **Students whose activity is mostly private will have lower ranking numbers than now.**
  Private activity remains collected and visible on ②.
  Measure ranking changes before/after cutover before deployment and notify sample students.
  Public PR bodies include only aggregate judgments, not raw per-student figures.
- **Our numbers differ from the GitHub profile graph.**
  Contribution types (we count releases, GitHub counts issues/reviews), periods (calendar year versus rolling 365 days), and timezones differ.
  Screen copy explains these differences.
- Removing individual identifiers makes a “what was contributed” list impossible.
  Retrospective backfill can restore it if needed.
- The year list is currently derived from `Contribution.date`.
  Moving ① to `contributionsCollection` eliminates that calculation because GitHub's `contributionYears` provides the list directly.
- `contributionsCollection` limits per-repository breakdowns (default 25), but this is irrelevant to ① because it uses `total*`.
- Sweeps do not rediscover external repositories — deleting their rows loses them permanently, with manual registration the only recovery.
  Do not reset data; use `확장 → 재수집 → 읽기 전환 → 드롭` (expand → recollect → switch reads → drop).

## Alternatives considered

**Wipe data and recollect.**
Organization repositories are rediscovered each sweep through `listInstallationRepositories()`, but DB rows are the sole record of external repositories, so they would be lost permanently.
Full recalculation already self-corrects, removing the reason to wipe data.

**Filter ranking by `Application` linkage.**
The dominant source of current ranking numbers is organization repositories without `Application` links, so ranking becomes zero.
The necessary distinction was neither inside/outside the organization nor linked/unlinked to a program, but **whether the person is a registered student**.

**Change the total to commits + PRs + issues + reviews.**
Following GitHub's contribution definition would align numbers with profiles, but would stop counting releases and lose contributions by teams delivering releases.
Keeping three types was selected.

**Use a four-stage transition with `Repository` and `programId` coexisting.**
Its premise disappeared when data disposal became unnecessary.

## Follow-ups

- **Move ① ranking to `contributionsCollection`.**
  This implements §1 reason 3; until then, ranking stops when collection stops.
  Production measurements confirmed rate-limit `cost=1` per student per year and a 5000/hour limit — 200 students queried hourly use 4% of the budget.
- **Fact-layer force-push reconciliation.**
  No path removes upstream-deleted commits from facts.
  Aggregates follow facts, so inflated facts produce inflated aggregates.
- **Completed (#730) — proof of `OWN` (`EXTERNAL_PUBLIC`) repository linkage on program screens.**
  Program screens prove application linkage in the DB through the `Repository` row and permit `EXTERNAL_PUBLIC` metrics only for that id.
  Linked OWN activity is shown without mixing unrelated personal repositories into organization performance.

- Add `Program.startAt` — the ② program period is provisionally `applicationStartAt` through `COALESCE(endAt, now())`.
  A precise activity start-date column is separate work.
- Completed (2026-08-10) — removed the 60-second in-memory cache of completed ranking results and public-response cache headers.
  External-repository PUBLIC/PRESENT revocation takes effect from the next anonymous request, with only concurrent requests combined by single-flight.
- Decide Phase 2 write strategy after one month of observability metrics.
- A surface for a student's complete university-life record — retain external collection infrastructure but defer the screen.
- **Defense in depth for ranking-read linkage.**
  Unlike program screens, ranking's repository predicates check only `visibility` and `presence`, not application linkage.
  The normal provisioning path creates a `Repository` row together, guaranteeing linkage, but any unlinked `EXTERNAL_PUBLIC` row created for any reason silently enters public ranking.
  Controlled verification on 2026-08-10 actually created that state, and ranking counted it.

## Changelog

- 2026-10-08: Abolished §7's Port/alias-injection-key policy and consolidated §8 layering conventions into ADR-003 §10.
  Earlier `REPOSITORIES_READ_PORT`, `COLLECTION_TRIGGER_PORT`, and contribution-tracking Port-count rules remain historical only; business questions and collection behavior retain their meaning.
  Distinguish structural approval from completion of all code migration.
- 2026-09-24: Added issue-only contributor display rules to §4's amendment — person lists not showing `issueCount` exclude people whose commit/PR/release sum is zero over the queried program-period/cumulative scope (#1133).
- 2026-09-24: Added the `Contribution.issueCount` amendment to §4 without deleting the existing body.
  It stores repository-dimension issue collection (#1133) without changing the total definition.
- 2026-09-24: #1133 PR2 (collection immediately after repository URL linkage) made parts of §6/§7/§10 stale, so dated amendments were added to each without deleting the original body.
  §6 records that an actual URL-connection change, once committed, can trigger one-shot immediate collection through `CollectionSchedulerService.collectRepository` without waiting for inventory observation.
  §7 records the new `COLLECTION_TRIGGER_PORT` in addition to the three contribution-tracking ports and provisioning port.
  §10 records that hourly updates are now the default, supplemented by post-link one-shots.
  Skips, lease conflicts with sweeps, or restarts between save and execution leave collection to the existing hourly sweep.
  Updated the corresponding [ADR-006](ADR-006-github-app-integration.en.md) Enables amendment in the same PR.
- 2026-08-20: Cross-referenced in §1 that absent `?year=` means the current year here, while [ADR-011](ADR-011-query-filter-type-boundary.en.md) owns the persistence type boundary and student activity's absent = all-time default.
- 2026-09-13: Corrected the product-decision source pointer to [`AGENTS.md` Important Files](../../AGENTS.en.md#important-files).
  The 2026-08-19 Changelog citation of `AGENTS.md` §2 remains a historical record.
- 2026-08-19: Added the shape where each dimension has its own acquisition as an amendment, without deleting the existing body.
  The person dimension populates `GithubUserActivityHistory` through `contributionsCollection` + `repositories(star)` GraphQL, with `(githubId, year)` granularity; ranking changed to five metrics (commit, PR, issue, repo, star) and their simple sum — this note amends `D7`'s three-type total.
  `release` became exclusive to ② program screens because person acquisition does not count it, leaving the repository dimension as its sole source.
  The authoritative product decision for the five metrics is the administrator-request-based Notion Decision Log (`AGENTS.md` §2); this ADR records only technical consequences.
  Explicitly disclosed manipulability of `star`/`repository` counts; `D15` was corrected to “`githubLogin` and `department`,” not abolished.
  `docs/rules/data-modeling.md` owns table shape, naming, and the rationale for no FK; do not duplicate them here.
- 2026-08-11: Corrected §2, which previously covered aggregation but not display inclusion or repository scope, by explicitly separating three axes: aggregation (existing wording retained), display (all registrants, including zero contributors; new PM decision on 2026-08-11), and repository scope (all organization repositories regardless of visibility; new PM decision on 2026-08-11).
  Clarified that expanding repository scope to include private-organization activity in public ranking numbers is separate from repository visibility itself (explicit publish under `ADR-006` and `docs/rules/security.md`).
  Republished consent documents (`apps/frontend/public/policies/`) as version `2026-08-11` and increased `CONSENT_POLICY_VERSION` to reflect the display/aggregation expansion.
- 2026-08-10: Unified new fact writers' `githubId ∈ User` boundary across ORG/EXTERNAL sources, excluding unregistered/unknown authors even in organization repositories without a specified team.
  Under D9, snapshot the registered-user set once at run/import start and propagate lookup failures before the first write.
  Narrow member lists and PR-backfill fingerprints to the same run snapshot so an account joining mid-run does not lose historical PRs; cutover shares one registered-user snapshot across import, provider verification, and fact parity.
  Do not delete legacy rows at runtime; track them through a separately approved data migration.
- 2026-08-10: Reflected the resolved conflict excluding OWN repositories on program screens through #730's DB proof of application linkage.
- 2026-08-10: Removed ranking/project/public-profile caches that delayed external-repository public revocation, retaining only concurrent-request single-flight.
- 2026-08-10: Recorded §11's substitute `OWN` acceptance (one controlled repository end-to-end) and execution results, and left missing ranking-read linkage defense in depth as a Follow-up.
- 2026-08-09: Initial decision establishing data-source separation for two read surfaces, person-based ranking filters, `(repositoryId, githubId, date)` granularity, three ports plus separate provisioning, Domain-first + Layered folders, Prisma-native writes, and Phase 2 conditions.
  Amends `ADR-003` DEC-42 Port constraints and `ADR-006`/`ADR-009` collection/display boundaries.
