---
slug: ADR-006-github-app-integration
date: 2026-07-21
author: Lumiere001
status: Accepted
references:
  - Issue-15
  - Issue-36
  - Issue-120
  - Issue-119
  - Issue-121
  - Issue-123
  - Issue-125
  - Issue-205
refines: []
---

# ADR-006: GitHub App Integration for Organization Automation

[한국어](ADR-006-github-app-integration.md) | **English**

English translation of the [Korean source](ADR-006-github-app-integration.md).
The Korean document remains authoritative.

## Status

Accepted

## Date

2026-07-21

## Context

User login continues to use the existing GitHub OAuth flow, but automation that creates organization repositories and invites collaborators after application approval, and organization-wide current-state collection, require authentication identities separate from user credentials.
This decision is the shared contract for #119, which creates `Application APPROVED + OutboxEvent PENDING`; #121, which consumes the outbox to create repositories and send invitations; the collection path that builds organization-wide current state through REST; and #125, which provides a separate publication action after milestones.

The pilot collects all existing and new repositories in the `JNU-SWCU` Organization, regardless of public/private visibility.
Combining organization-wide collection read access with permission to create, invite collaborators to, and publish platform-managed repositories in one App would grant unnecessary `Administration: write` access across the organization.
Therefore, separate these roles into distinct GitHub Apps and installations.

REST collection of repository activity from personally owned repositories through the Collection App installation-token path is outside the pilot scope.
However, since the 2026-08-04 amendment, public repositories outside the organization explicitly registered by students are included through a separate collection-only credential and GraphQL discovery; subsequent commit/PR/release detail collection uses the same REST path as organization repositories (see “Public repository collection outside the organization” below).
The read-only App that students install themselves under #15 remains a separate post-pilot decision and does not reuse this ADR’s credentials or permissions; it is also unrelated to the collection-only service-account PAT added on 2026-08-04.
The distinction is that students install the App in #15 themselves, while the service holds the collection-only PAT without requiring student installation.

## Decision

### Authentication identities and permission boundaries

Register separate organization-owned `Collection App` and `Repository Operations App` instances for test and production, and install them in each environment’s target organization.
Each App uses only its own installation access tokens, not user OAuth tokens or user access tokens.

The `Collection App` reads only metadata, default-branch commits, all-state pull requests, published releases, and all-state issues for organization repositories through REST; it cannot create repositories or change collaborators/visibility.
The `Repository Operations App` only creates platform-managed repositories, invites collaborators, and changes visibility; it does not have organization-wide collection authority.
The two Apps do not share App IDs, private keys, or installation-token caches.

Test and production Apps do not share App IDs, private keys, installation-token caches, or target organizations.
The target organization owner reviews and approves App registration and permission changes; do not deploy features that require new permissions that have not been approved.

### Repository ownership and user permissions

The technical owner of repositories is the `JNU-SWCU` Organization.
For individual applications, the applicant receives `push` collaborator access to contribute to, use, and access their repository; for team applications, the team leader and members at approval time receive that access.
This permission does not transfer code copyright or IP to the project office or establish joint copyright; licenses and deliverable IP conditions belong in separate program terms.
Students outside the team cannot access its private repository or metrics.
Organization-wide visibility-change authority may be used only through approved staff/admin actions, and App credentials themselves must not leave the backend secret store.

### Installation scope and discovery

Install the `Collection App` with `All repositories` to collect all existing and new repositories in the `JNU-SWCU` Organization, regardless of public/private visibility.
This installation has read permissions only, no write/admin permissions, and no configured webhook URL, event subscriptions, or webhook secret.

Install the `Repository Operations App` with `Only select repositories`.
Among existing organization repositories, select only those the platform actually manages, and use GitHub’s behavior of automatically adding repositories newly created by this App to its installation’s accessible repositories.
This avoids granting `Administration: write` to all unrelated organization repositories.

Using the configured organization login, the service calls `GET /orgs/{org}/installation` with each App’s JWT and verifies the role-specific installation ID and installed account.
An installation ID is not a credential; do not pin it in a separate environment variable, but cache discovery results in process memory.
If the response account login or `app_id` differs from the configuration, do not begin installation-token issuance or API calls.
If the `Collection App` installation cannot be verified, stop organization collection; do not substitute user OAuth tokens, user access tokens, or PATs.
If the `Repository Operations App` installation cannot be verified, disable repository provisioning for that program.
#119 approves applications in a program with this feature disabled without creating an outbox event, while already-pending #121 jobs remain on the operations screen as final failures caused by the missing installation.

The five required configuration names are:

- `GITHUB_APP_ORG`
- `GITHUB_COLLECTION_APP_ID`
- `GITHUB_COLLECTION_APP_PRIVATE_KEY_FILE`
- `GITHUB_OPERATIONS_APP_ID`
- `GITHUB_OPERATIONS_APP_PRIVATE_KEY_FILE`

Store actual values only in the deployment environment’s approved secret store.
Keep only the secret-store record name, rotation owner, and reference location in the Obsidian operations inventory; do not duplicate values.
Do not record actual values or private-key examples in ADRs, Issues, PRs, commits, logs, or Notion.

### Endpoints and minimum permissions

| Role | Action | GitHub REST endpoint or event | Required GitHub App permission | Rule |
| --- | --- | --- | --- | --- |
| Collection App | List installation repositories | `GET /installation/repositories` | Repository `Metadata: read` | Paginate the organization-wide list within the `All repositories` scope. |
| Collection App | Read organization repository metadata | `GET /repos/{owner}/{repo}` | Repository `Metadata: read` | Determine organization membership and mapped/unmapped state. |
| Collection App | Read commits | `GET /repos/{owner}/{repo}/commits` | Repository `Contents: read` | Backfill the entire default branch for new repositories; for existing repositories, probe the default-branch head and traverse only until a known SHA is reached. |
| Collection App | Read pull requests | `GET /repos/{owner}/{repo}/pulls` | Repository `Pull requests: read` | Fix the query to `state=all&sort=created&direction=desc` and use the `(createdAt, githubPullRequestId)` tie frontier to read only new PRs. |
| Collection App | Read issues | `GET /repos/{owner}/{repo}/issues` | Repository `Issues: read` | Use the same fixed `state=all&sort=created&direction=desc` query as pull requests and the `(createdAt, githubIssueId)` tie frontier to read only new issues. |
| Collection App | Read published releases | `GET /repos/{owner}/{repo}/releases` | Repository `Contents: read` | Include published releases only, excluding drafts. Reread the complete published-release list only for repositories whose probe changed, and deduplicate by ID. |
| Repository Operations App | Create a private organization repository | `POST /orgs/{org}/repos` | Repository `Administration: write` | Fix creation requests to `private: true`. |
| Repository Operations App | Read repository metadata | `GET /repos/{owner}/{repo}` | Repository `Metadata: read` | Compare external repository ID, name, and visibility. |
| Repository Operations App | Check collaborator membership | `GET /repos/{owner}/{repo}/collaborators/{username}` | Repository `Metadata: read` | `204` is a successful state indicating an existing collaborator. |
| Repository Operations App | Check pending invitations | `GET /repos/{owner}/{repo}/invitations` | Repository `Administration: read` | Do not resend an open invitation for the same login. |
| Repository Operations App | Invite a collaborator | `PUT /repos/{owner}/{repo}/collaborators/{username}` | Repository `Administration: write` | Use `permission: push`, the minimum role students need. |
| Repository Operations App | Change private to public | `PATCH /repos/{owner}/{repo}` | Repository `Administration: write` | After the staff action in #125, change to `visibility: public` and read metadata again. |

The `Collection App` requests only Repository `Metadata: read`, `Contents: read`, `Pull requests: read`, and `Issues: read`.
`Issues: read` was added on 2026-09-24.
The three permissions granted before approval of the new installation permission are also accepted; until approval, only the issue stream remains in a permission-error state.
The `Repository Operations App` requests only Repository `Administration: write` and `Metadata: read`.
Neither App requests organization permissions, including Organization `Members`.
`Administration: write` also satisfies the `Administration: read` requirement for reading invitations.

The Collection App’s only collection authority is the GitHub REST API using installation tokens; do not run webhook, OAuth, or PAT paths alongside it or use them as fallbacks.
Pin API requests to `X-GitHub-Api-Version: 2022-11-28`.

### Organization-wide cumulative and incremental collection (canonical contract)

All repositories in the `JNU-SWCU` organization within the Collection App installation scope are internal tracking targets **regardless of visibility**.
Mapped/unmapped and private/public repositories are all included; private/public determines **whether fields/rows may be exposed in external responses, not whether collection is permitted**.
Repositories outside the organization and personally owned repositories are outside this scope.

Metrics represent **cumulative unique activity observed at least once**, not GitHub’s current reachability/state.

```text
commit  unique key  = (repositoryId, sha)
PR      unique key  = (repositoryId, githubPullRequestId)
release unique key  = (repositoryId, githubReleaseId)
issue   unique key  = (repositoryId, githubIssueId)
```

Force-pushes, PR state changes, and release deletion do not decrease counts of already-observed unique activity.
Reobservations, retries, and duplicate responses do not increase counts because of the unique keys.
This cumulative contract means there are no tombstone/reachability recalculations or periodic organization-wide full-history reconciliations.

New repositories receive one full backfill of all four streams: commits, PRs, releases, and issues.
Existing repositories receive a full installation inventory on each hourly run, but each stream processes only changes beyond its endpoint-specific safe frontier.

- Commit: when the default-branch head probe changes, traverse newest to oldest until reaching a known SHA.
  **Only a disconnected repository** with no intersecting SHA gets a reread of its entire current default branch, deduplicated by SHA before advancing the frontier.
- Pull request: fix the query to `state=all&sort=created&direction=desc` and read only until crossing the `(createdAt, githubPullRequestId)` tie frontier.
- Issue: use the same fixed query as pull requests and the `(createdAt, githubIssueId)` tie frontier.
  Pull requests mixed into the list (the `pull_request` key) are used only to determine the frontier, not stored; treat `410` (issues disabled) as an empty list.
- Release: **only repositories** whose fixed probe representation (latest published release ID/time) changes get a complete reread of published releases, deduplicated by `(repositoryId, githubReleaseId)`.
  Draft releases remain excluded.

These complete rescans are exceptional recovery scans for the specific repository where a change was detected, not periodic organization-wide reconciliation that repeatedly recollects unchanged repositories.

Identify each request by an **exact request fingerprint** including endpoint, ref/branch, ordering, query, page size, `Accept`, and `X-GitHub-Api-Version`.
For that fingerprint, use a nullable `ETag` in conditional GET (`If-None-Match`); a `304` skips that repository’s corresponding stream.
Do not reuse ETags across fingerprints, and do not make ETag availability or success a prerequisite for correctness: the safe fallback is always the SHA/tie/ID-deduplicating traversal above.

Provider requests pass through one fair serial queue, paced at intervals of at least 250ms.
When the remaining rate limit falls to `max(100, limit의 20%)` or below (100 or 20% of the limit, whichever is greater), stop the run safely and continue on the next run from the durable continuation cursor (repository IDs in oldest-first order).
Do not restart every run from repository 1.

Each endpoint is limited to a maximum of 100 pages.
A stream that reaches a page limit, rate limit, permission error, or partial failure must not advance its checkpoint or aggregate; retain the previous successful state.
Retries resume from the failed stream’s checkpoint without merging partial results into committed state.
Immediately project REST responses down to repository/commit/pull-request/release/issue numeric IDs, event times, deduplication keys, and agreed derived counts, then discard the responses.

### Public repository collection outside the organization — external credentials and discovery

Public repositories where students work outside the organization are also tracking targets.
This extension only adds a separate path alongside the Collection App installation-token authority; it does not change that authority.

**Why a second credential is unavoidable.**
GitHub’s official documentation states the installation access token boundary as follows.

> "The installation access token cannot be granted access to repositories that the installation was not granted access to."
> — [Authenticating as a GitHub App installation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)

Although documentation says GitHub Apps have implicit read access to public resources, this refers to **user-to-server tokens** issued when a user authorizes an App; it **does not apply to the installation (server-to-server) tokens used in this ADR** ([Choosing permissions for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)).
REST and GraphQL share the same installation-scope rules.
Therefore, no Collection App token can structurally read repositories outside the `JNU-SWCU` installation scope, and this extension cannot work without a separate credential.

**Selected credential — a service-account fine-grained PAT.**
Use the same credential for both REST (detailed fact collection) and GraphQL (discovery).

**Relationship to the PAT collection path removed by C2 — different scopes.**
At the time, the Purpose paragraph in `apps/backend/src/collection/AGENTS.md` said, “Webhook/OAuth/PAT collection paths were removed by C2 (#151, ADR-006), and REST reconciliation is the only collection authority.”
Its basis is this ADR’s “cutover and rollback” item under “Alternatives considered” (lines 381–386 above): C2 switches to “REST complete generation as the sole current-pointer authority and removes the Collection webhook URL/event subscriptions/secret,” and the rollback procedure explicitly does not restore “webhook credentials or OAuth/PAT fallbacks.”
The subject of this decision is **the current-pointer authority of the Collection App reading organization repositories within the `JNU-SWCU` installation scope**.
The Purpose paragraph itself defined that module’s collection target as “all repositories within the organization installation scope (excluding repositories outside the organization and personal-account repositories),” so anything beyond that scope was never covered by the statement.
The service-account PAT (`GITHUB_PUBLIC_READ_TOKEN`) introduced here is a separate authority solely for **public repositories outside the organization**, which installation tokens cannot structurally reach; it does not return organization repository current-pointer authority to PATs.
That current pointer still has exactly one authority: the Collection App installation token (REST reconciliation).
Therefore, introducing this PAT does not supersede C2: C2 removed “webhook/OAuth/PAT as organization collection authorities,” while this PAT establishes a new authority in a separate scope (collection outside the organization) that C2 never addressed.

The Separation of authority section in [`apps/backend/src/github/AGENTS.md`](../../apps/backend/src/github/AGENTS.en.md) is the current authoritative source for permission separation.
Approved repository creation uses the Operations GitHub App, organization collection uses the Collection GitHub App, and external public/person reads use the public-read PAT; credentials and rate budgets must not be fallbacks for one another.
Do not restore the retired `collection/AGENTS.md`.

**Evidence rechecked against the original Issue #151.**
The text inside this ADR alone does not fully explain the background of the citation “C2 (#151, ADR-006),” so the body and comments of Issue #151 were checked directly.
The original scope of #151 (“Backend: periodic GitHub repository collection scheduler”) was scheduling **the authentication method that existed at the time**: batch collection of organization repositories through the pre-GitHub-App collection.service.ts/github-api.client.ts path and the `CollectionRun`/`GithubRawObservation` tables.
It explicitly stated, “GitHub App migration belongs to #120. This ticket keeps the current authentication method,” placing the App migration itself outside its scope.
Later comments expanded implementation to the GitHub App REST-only transition; the final comment (“E1 complete... actual Collection App installation, REST-only collection, public/private boundaries, 2-instance leases, and live smoke PASS have been demonstrated, so after C1 confirmation we will proceed with C2 retirement”) explicitly called C2 **“retirement.”**
C2 therefore retired the **existing** webhook/OAuth/PAT organization-collection paths (then `collection.service.ts`/`github-api.client.ts`) and consolidated them into Collection App installation-token REST-only collection.
Nowhere in #151 did the concept of collecting public repositories outside the organization or on personal accounts appear; that concept came later in `.omc/plans/github-repository-unification.md`.
The sentence in this ADR’s “Endpoints and minimum permissions” section saying “The Collection App’s only collection authority is the GitHub REST API using installation tokens; do not run webhook, OAuth, or PAT paths alongside it or use them as fallbacks” (line 112 above) explicitly names **the Collection App** as its subject.
The first paragraph of the immediately following “Organization-wide cumulative and incremental collection” section also draws its own boundary: “Repositories outside the organization and personally owned repositories are outside this scope” (line 119 above).
All three pieces of evidence—the original Issue #151, ADR line 112, and ADR line 119—point to the same conclusion: **option 1 (scope clarification), not option 2 (superseding a blanket prohibition).**
The new decision does not overturn C2; it establishes a separate authority for a scope C2 never addressed: collection outside the organization.

**Relationship to forbidden fields and public-evidence constraints.**
The “Stored/discarded field inventory” section already states, “Collection of public repositories outside the organization follows the same field inventory: stored fields match organization repositories, and the extension above adds no fields” (line 225 above).
PAT-collected fields therefore follow the same forbidden-field list as the organization path, including prohibitions on storing raw responses, code, diffs, commit messages, author emails, PR titles/bodies, and release bodies; introducing a PAT does not expand storage scope.
The public API exposure, fail-closed, and partial-inventory rules in “Public exposure and complete/partial inventories” (lines 229–236 above) are repository-wide rules that do not branch on the `source` column, so they apply equally to `EXTERNAL_PUBLIC` rows.
That section does not distinguish organization/external repositories, meaning there is no separate exception, but previously it did not explicitly state that the same rules apply externally.
This is made explicit here so future readers do not need to rely on inference.

> "Tokens always include read-only access to all public repositories on GitHub."
> — [Managing your personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)

Fine-grained PATs always include read-only access to all public repositories, regardless of repository selection or permission settings.
Thus, the public repository reads required for this extension work without individually granting permissions for each student repository outside the organization.
Rate limits are based on the authenticated user.

> "All of these requests count towards your personal rate limit of 5,000 requests per hour."
> — [Rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)

**Why OAuth App client ID/secret Basic Auth was considered first but not adopted — correction record.**
REST documentation allows OAuth Apps to read public data at up to 5,000 requests/hour by sending client ID/client secret in an HTTP Basic Auth header (the rate-limits document above), so it was considered as a credential requiring no expiration management.
It was rejected because **it does not apply to GraphQL**, which would split credentials into two.
Specifically, as `lane-graphql` confirmed while implementing the discovery client, OAuth App client ID/secret Basic Auth is documented for REST only; GraphQL v4 does not accept it and requires a bearer token tied to an actual authenticated identity.
Because this extension uses GraphQL for discovery and REST for detailed collection, choosing OAuth App Basic Auth would still require a separate PAT for GraphQL.
The only reason for considering the OAuth App—“no expiration management”—would disappear, leaving the net cost of two credentials.
The reasoning for consideration and rejection is also retained under “Public repository collection outside the organization — OAuth App client ID/secret Basic Auth” in “Alternatives considered” to avoid repeating this investigation.

**PAT issuance and rotation remain an operational burden.**
Unlike installation tokens, PATs are long-lived credentials whose expiration and rotation the service must manage itself.
Mitigate this as follows.

- Issue the PAT through a project-office **service account**.
  A personal account would interrupt collection when that person leaves the organization, and the identity of a personal account with public-repository read access itself creates a real-name exposure risk.
- Record the expiration date and rotation owner in operations documentation (the secret-store record referenced by the Obsidian operations inventory); do not record the token value there either.
- Explicitly reject absent/expired credentials in a **fail-closed** manner.
  Do not silently skip only outside-organization public repository collection: silent skips create a state where “rankings are zero and nobody knows.”

This PAT is **separate** from the `GITHUB_OAUTH_*` App used for student login.
Reusing that App would make collection fail whenever a login-authentication incident required secret rotation, and would mix quotas with login traffic.
Separate issuance isolates failures and quotas across the two axes.
Use one environment key, `GITHUB_PUBLIC_READ_TOKEN`, for both REST and GraphQL calls: a new name distinct from `GITHUB_OAUTH_*` (student login), `GITHUB_COLLECTION_APP_*` (organization collection), and `GITHUB_OPERATIONS_APP_*` (repository provisioning).

**Unchanged boundaries.**
Only public repositories are collection targets.
Do not store student access tokens on this path either; this is an absolute principle already established by this ADR and unchanged by the extension.
Collecting student tokens to increase rate limits was not considered, and GitHub Terms of Service Section H prohibits “token sharing to circumvent rate limits,” independently of our decision.

**GraphQL is for discovery only.**
Use GraphQL `contributionsCollection` only to obtain the list of repositories outside the organization (`nameWithOwner`); then reuse the existing REST paths in the “Endpoints and minimum permissions” table for commit/PR/release detail collection.
Discovery uses the same service-account PAT (`GITHUB_PUBLIC_READ_TOKEN`).
**Unverified:** neither GraphQL documentation nor GitHub Apps authentication documentation explicitly permits or prohibits installation tokens from querying top-level fields such as `user(login:)` and `contributionsCollection` for users outside the installation scope.
To avoid depending on this unverified behavior, standardize discovery on the PAT rather than installation tokens.

> **2026-08-19 amendment — GraphQL is no longer limited to discovery.**
> Retain the paragraph above as the 2026-08-04 record and broaden its scope only.
> Person-axis ranking (ADR-010’s 2026-08-19 amendment note) queries each student’s yearly activity directly through GraphQL, so GraphQL now serves **both discovery and person-axis metrics**.
> The metrics query is `user(login:){ contributionsCollection(from,to) … repositories(ownerAffiliations: OWNER, privacy: PUBLIC) }` and **uses the same service-account PAT (`GITHUB_PUBLIC_READ_TOKEN`)**; it adds neither credentials nor installation-token dependencies.
> This extension does not alter the “Unchanged boundaries” above: queries are public-only (`privacy: PUBLIC`), student access tokens are neither used nor stored, and there is no token pooling.
> REST detail collection remains on the repository axis.
> The measured cost is `cost=1` per student per year (2026-08-19).

### Consent-scope gate — collection can be enabled only after the consent document is revised

**When this section was written (2026-08-04), the live consent document explicitly excluded personally owned repositories from collection.**
The GitHub activity consent document referenced by `CONSENT_POLICY_VERSION` (`apps/backend/src/consents/domain/consent-policy.ts:8`) stated:

> “We use identifiers and visibility of JNU-SWCU Org repositories, activity times/types, and minimum repository-level aggregates for program operations and community-engagement metrics. Personally owned repositories are not collection targets under this policy.”

Students had consented to that wording.
The outside-organization public repository collection designed by this ADR targets exactly what that wording excluded—personally owned repositories—so the design directly conflicted with the live consent scope at the time.

**2026-08-11 correction.**
The quotation above was already stale when this section was actually committed (`464c7b11`, 19:39): 17 minutes earlier, at 19:22, `6ff4ccb3` had raised `CONSENT_POLICY_VERSION` to `2026-08-04`, but this section was committed still citing the previous `2026-07-21` version as “currently live.”
The actual latest consent document is `apps/frontend/public/policies/github-activity/2026-08-11.html`; its “Public ranking display” section states that organization repository activity is included in public ranking aggregates regardless of visibility.
**However, this extension concerns the organization repository aggregation scope; it does not enable automatic discovery of personally owned public repositories outside the organization discussed above.**
Automatic discovery of outside-organization public repositories remains disabled by the “consent-scope gate” below.

**Exposure path.**
`GET /ranking` (`apps/backend/src/ranking/ranking.controller.ts:12,16`) is an unauthenticated public endpoint without an authentication guard.
`RankingService` (`apps/backend/src/ranking/ranking.service.ts:110-111`) chooses the student’s real name (`user.name`) for `displayName` if available, falling back to `githubLogin` only otherwise.
Enabling this extension would therefore expose aggregated personal-account and third-party OSS activity alongside students’ real names on an unauthenticated public page.

**This is an activation gate, not a merge gate; keep the distinction clear.**
The constraint does not prevent merging schema, discovery-client, or REST detail-collection wiring because those alone collect nothing.
Currently, `CollectionDiscoveryClient` is not registered as a provider in any module (no reference in `collection.module.ts`), `CollectionSyncService.runExternal()` fails immediately unless `externalRuntimeFactory` is injected, and no scheduler or controller calls it.
The automatic discovery (GraphQL) path that creates `EXTERNAL_PUBLIC` source rows is not implemented either; the pipeline is therefore structurally inert.
What this gate blocks is not merging but **activation of a path that actually creates `EXTERNAL_PUBLIC` rows**: registering the discovery client as a provider, wiring `externalRuntimeFactory`, and connecting it to a scheduler.

**New constraint.**
Enable outside-organization public repository collection (= introduce code that creates `EXTERNAL_PUBLIC` rows) only after revising the GitHub activity consent document and increasing `CONSENT_POLICY_VERSION`.
A version increase triggers re-consent.
The reason is that obtaining re-consent after information has already been exposed alongside real names cannot undo the exposure; consent must be updated before activation.

**Open question — not decided by this ADR.**
This ADR does not choose between incorporating external collection by revising the existing `GITHUB_ACTIVITY` consent wording and creating a separate consent item, such as a dedicated opt-in for public repositories outside the organization.
This is a program-operations policy decision for PM/operations.

**Separate matter — policy decision D3 (standardizing public display on GitHub nicknames) is implemented.**
This is the decision named “D3 (public display = GitHub nickname only)” in the open questions of `.omc/plans/github-repository-unification.md` §11.
It differs from “D3 | delete `Repository`” in the phase D task table in the same document’s §7; the identifier is duplicated, so do not confuse them.
**This decision is now reflected in code**: `RankingService.buildEntries` (`ranking.service.ts`) fixes `displayName: entry.githubLogin`.
The path exposing real names in public rankings is therefore closed.
`UserDisplayNameRepository` no longer participates in choosing display names; its removal is handled separately.
The current authoritative display boundary is [ADR-010](ADR-010-contribution-tracking-context.en.md) §5: private organization contributions continue to be collected but are excluded from public rankings and shown only on program screens after authentication.

### Stored/discarded field inventory

Internal DB storage is limited to the following fields needed to determine collection scope and cumulative aggregates.

- Repository: `githubRepositoryId`, repository name within the organization, **visibility (private/public)**, default branch, and mapped/unmapped state.
- Commit fact: `(repositoryId, sha)` and event time.
  Do not store commit messages, author emails, diffs, or code content.
- PR fact: `(repositoryId, githubPullRequestId)` and observation time.
  Do not store titles or bodies.
- Release fact: `(repositoryId, githubReleaseId)` and event time.
  Do not store bodies.
- Issue history (`GithubIssueHistory`): `(repositoryId, githubIssueId)` and event time.
  Do not store titles or bodies.
- Contributions from people outside the team (`GithubRepositoryOutsiderContribution`): one row per team repository—commit/PR/issue counts within the program period, the application ID/program ID/period used for counting, and observation time.
  Do not store author login or githubId (ADR-009, “Outside contributors — retain counts only”).
- Aggregates: cumulative commit/PR/release/issue counts per repository/contributor, last observation time (watermark/frontier), and stream state.

Do not retain raw responses, code/diffs, commit messages/author emails, pull-request titles/bodies, release bodies, issue titles/bodies, user profiles, or credentials (JWT/private key/installation token) in the DB, caches, logs, or public smoke artifacts.
Repository `githubRepositoryId`, name, and visibility are stored in the internal collection DB, but private repository identifying information (name, existence, visibility) must not appear **in public API responses or public smoke artifacts**.
The previous wording, “Do not retain private repository identifying information,” conflicted with the actual implementation because it failed to distinguish internal storage from public exposure; the layers are separated here to correct that.

Collection of public repositories outside the organization follows the same field inventory: stored fields match organization repositories, and the extension above adds no fields.

**Attribution-signal reliability — a limitation resulting from the field inventory.**
A commit response’s top-level `author` (GitHub account mapping) is populated **only when the email used in the commit is registered with that account**.
Because this ADR does not store raw commit author emails (the inventory above), a commit by a student whose email is not registered with GitHub cannot be attributed to any student; do not attempt heuristic email matching, which would violate the field inventory.
By contrast, PRs (`pulls[].user.login`) and releases are always account-based, so attribution is always available unless the account was deleted.
Rankings/contribution aggregates therefore use PRs and releases as the **primary attribution signals**, and commit `author.login`, populated only for registered emails, as a **secondary signal**.
This is an interpretation rule for aggregates/rankings, not a schema change; this ADR explicitly records the correctness limitation that contributions cannot be fully reconstructed from commits alone.
A separate screen needs to tell students, “Register your commit email with your GitHub account for commits to be counted.”

### Public exposure and complete/partial inventories

Public API exposure requires both platform publication eligibility and the **latest complete Collection inventory observation**.
A private/missing state observed after `publishedAt` immediately blocks public exposure (fail-closed).
An old private observation from before publication does not block a just-completed managed publication.
Partial inventories (only partially observed because of page/time/rate limits or permission errors) are not evidence of missing repositories; activity-stream failures and safe visibility/presence observations are separated into distinct fenced transactions.

Subsequent REST client tests must cover endpoint-specific safe frontiers and exceptional complete scans, nullable exact-request ETags and no cross-fingerprint reuse, the 100-page limit, storage of permitted fields and non-storage of forbidden fields, no checkpoint advancement on partial failure, and revocation of public exposure based on complete/partial inventories.

These rules apply identically per repository without branching on `source` (`ORG_PROVISIONED`/`EXTERNAL_PUBLIC`).
`EXTERNAL_PUBLIC` rows populated through outside-organization public repository collection (the service-account PAT path) are subject to the same publication, fail-closed, and partial-inventory non-missing rules without exception.

### Approval-time collaborator snapshot

When #119 approves an application and creates its outbox event in the same transaction, it computes the collaborator login list at approval time.
Use the applicant’s single login for individual applications and the team leader/member logins at approval time for team applications.
Normalize logins case-insensitively, sort and deduplicate them, and store them in the outbox JSON’s `collaboratorGithubLogins`.

```json
{
  "applicationId": "application-fixture-id",
  "programId": "program-fixture-id",
  "teamId": null,
  "requestedAt": "2026-01-01T00:00:00Z",
  "collaboratorGithubLogins": ["fixture-student"]
}
```

#121 consumes this snapshot rather than recalculating current team membership when the worker runs.
The change uses the existing `OutboxEvent.payload Json`, so it adds no schema or migration.

If the user is already a collaborator, record the invitation as successful.
If an open invitation exists for the same login, converge on `PENDING` without sending another.
A new invitation’s `201` response also indicates successful delivery and is recorded as `PENDING`; a `204` response granting immediate access, such as for an organization member, is recorded as `SUCCEEDED`.

Nonexistent logins and outside collaborators blocked by organization policy are final failures.
Classify GitHub’s documented per-repository 24-hour invitation limit as retryable; retry only failed invitations after the next 24-hour window without recreating the repository.

### JWTs and installation tokens

Each App creates an `RS256` JWT with its own App ID and private key.
Allow for clock skew by setting `iat` to 60 seconds before the current time and `exp` to no more than 10 minutes after creation.
Use the JWT only for `POST /app/installations/{installation_id}/access_tokens`; do not store it.

Cache installation access tokens only in process memory until GitHub’s returned `expires_at`.
For each App role and installation ID, a process shares one refresh promise starting 5 minutes before expiry to prevent concurrent reissuance.
Do not introduce a shared cache or new infrastructure.
If the API returns `401`, discard the existing token, reissue once, and retry the request.

Do not store tokens, JWTs, private keys, the `Authorization` header, or complete request/response headers in logs or the DB.
Only validated numeric values of `retry-after`, `x-ratelimit-remaining`, and `x-ratelimit-reset` needed for rate-limit handling may appear in structured logs.

### Errors and retries

Align error classifications with #121’s durable job state.

| Condition | Classification | Handling |
| --- | --- | --- |
| Network timeout/connection failure | `FAILED_RETRYABLE` | Retry the same stage after the configured backoff. |
| `429`, or `403` classified as rate-limited | `FAILED_RETRYABLE` | Choose the next execution time using `Retry-After`, then reset time, then a minimum 1-minute delay, in that order. |
| GitHub `5xx` | `FAILED_RETRYABLE` | Retry after the configured backoff. |
| `401` | Refresh the token once, then reassess | Another `401` after refresh is a `FAILED_FINAL` authentication error. |
| Non-rate-limit `403` | `FAILED_FINAL` | Check App permissions, organization policy, and installation state. |
| Installation lookup `404` | `FAILED_FINAL` | Record a missing installation or incorrect target organization. |
| Pre-creation repository metadata lookup `404` | Normal branch | Treat the repository as nonexistent and proceed to creation. |
| Invalid login/input validation `422` | `FAILED_FINAL` | Store only non-sensitive error codes. |
| Response confirmed as an invitation limit | `FAILED_RETRYABLE` | Retry only the failed invitations after the next 24-hour window. |

Transition to `FAILED_FINAL` when retries are exhausted.
Log only event ID, job ID, application ID, attempt, and normalized error code.

### Collection current-state data minimization

The Collection App includes mapped and unmapped repositories in the same organization-wide incremental collection scope without inventing mappings to nonexistent programs or teams.
Expose private repository metrics only to approved staff and the corresponding team, not to students outside that team.
Do not delete or reset accumulated observed facts and aggregate history when visibility changes.
Public surfaces and public evidence permit only synthetic identifiers and aggregate results; exclude actual organization logins, repository full names, user data, and values from which private status can be inferred.

### One-time transition to cumulative storage and retention of the previous generation

Do not maintain a long-running dual-run when moving from the existing hourly organization-wide full-history generation store to the cumulative/incremental facts and aggregate store above.

1. Add fact/aggregate/checkpoint models through an additive schema in the new store.
2. Backfill the last successful existing generation into the new facts/aggregates once.
   This backfill does not create new ETags/frontiers; imported streams remain `VERIFYING` until a safe frontier is established by traversing the provider again.
3. After synthetic parity checks (existing aggregates = backfill results) and retry idempotency pass, turn off the old writer and atomically switch to the new readers/writers at one release/configuration boundary.
4. Retain old generation tables read-only for rollback for one release after cutover.
   Rollback is limited to restoring their last successful generation as current.
5. After the retention window ends, remove old generation tables through a separately tracked follow-up migration, not as part of this ADR’s cutover itself.

### Live smoke contract

Automated tests may use only GitHub API mocks and synthetic fixtures to verify success, rate limits, permission errors, duplicate requests, and non-advancement of streams after partial failures.
Run live smoke only after an approved test organization and role-specific test Apps are ready.

Run Repository Operations App smoke in this order.

1. Create one private repository with a synthetic name and record `201` and the external repository ID.
2. Process the same application fixture repeatedly and confirm that only one repository exists.
3. Invite one synthetic test collaborator, read the invitation, repeat the request, and confirm that invitations do not multiply.
4. Read repository metadata, make the repository public, then recheck visibility.
5. Clean up the test repository and confirm deletion with a `404` lookup.

A PASS and attached public-safe evidence from this smoke are the conditions for taking PR #204 out of Draft.

The Collection App’s E1 smoke uses public and private synthetic repositories prepared with commits, all-state PRs, and published releases.
Before API calls, normalize repository/organization permission maps and repository selection from the test App’s installation settings and token-issuance response.
Repository permissions must be only `Metadata: read`, `Contents: read`, and `Pull requests: read` (optionally `Issues: read`), organization permissions must be empty, and repository selection must be `All repositories`; FAIL if a webhook URL/event subscription exists or any permission is outside the allowlist.
Then use the actual installation token to confirm successful metadata/default-branch commit/all-state PR/published release reads for both synthetic repositories and advancement of each repository’s streams to `READY`.
Do not use write requests to verify least privilege, because misconfigured permissions could cause actual changes.

Public evidence may contain only normalized permission maps, repository selection, whether webhooks are unconfigured, endpoint types, status codes, synthetic fixture categories, UTC times, and backfill/incremental results.
Exclude tokens, secrets, headers, private keys, actual organization/repository/user data, and private identifying information.
Live smoke is currently pending because an approved non-production organization, role-specific test Apps, an organization-owner installation/permission approval path, public/private synthetic repositories, and secret-store injection are not yet ready.
The ADR is `Accepted` by PM decision, but this status does not mean that actual App installation, Collection REST cumulative/incremental collection, or #121 implementation verification is complete.
Until a non-production path is specified, both App integrations fail closed and live smoke remains an implementation-verification blocker.

## Alternatives considered

### Expanding user OAuth token permissions

- Pros: reuses the existing login flow.
- Cons: organization automation depends on a particular user’s login, consent, and token lifetime, combining login credentials with write automation.
- **Rejected:** conflicts with the repository security rule prohibiting write API calls with student user tokens.

### Fine-grained PATs and service accounts

- Pros: initial API-call implementation is simple.
- Cons: ties long-lived credentials and manual rotation to a personal or service account without providing installation revocation or repository selection.
- **Rejected:** has greater operational dependency than GitHub Apps, which manage organization ownership, short-lived tokens, and minimum repository permissions; PATs cannot be allowed as Collection authority.
  This judgment is limited to the Collection authority reading organization-owned repositories.
  Credential choices for public repositories outside the organization, which installation tokens cannot reach in the first place, are handled separately in “Public repository collection outside the organization” and the “Public repository collection outside the organization — OAuth App client ID/secret Basic Auth” alternative below.

### Combining read/write in one `All repositories` App

- Pros: fewer App registrations, installations, and credentials to operate.
- Cons: grants `Administration: write` to all repositories, exceeding the scope required for organization-wide collection.
- **Rejected:** compromise of read credentials would immediately compromise creation/invitation/visibility authority across the organization, violating least-privilege boundaries.

### One App with narrowed installation-token permissions

- Pros: each call can request a token with a subset of repositories/permissions, reducing privileges on normal paths.
- Cons: the App registration itself retains organization-wide administrative authority, and a holder of the private key can issue broader tokens, so credential boundaries remain combined.
- **Rejected:** cannot limit the blast radius of mistakes or credential compromise at the App level.

### `Only select repositories` for both Apps

- Pros: restricts every App’s repository scope to platform-managed repositories.
- Cons: fails the pilot contract requiring the Collection App to automatically collect all existing/new organization repositories.
- **Rejected:** use `Only select repositories` only for the write App; install the read-only Collection App with `All repositories`.

### Hybrid REST/webhook collection

- Pros: webhooks can quickly reflect changes, while REST repairs omissions.
- Cons: creates two authorities for the same facts with different idempotency/checkpoint contracts, making atomic current-state generations difficult to guarantee.
- **Rejected:** the Collection App uses one deterministic REST authority only.

### Webhook-only collection

- Pros: processes only changes, reducing routine REST calls.
- Cons: cannot fully reconstruct pre-installation state, missing deliveries, or current all-state PR/published-release state.
- **Rejected:** does not satisfy organization-wide atomic current state or bounded incomplete semantics.

### Cutover and rollback

C1 deploys REST generations while leaving the existing path in charge of the current pointer, then compares public/private synthetic E1 results.
After E1 passes, C2 makes REST complete generations the sole current-pointer authority and removes the Collection webhook URL/event subscriptions/secret.
M3 pins the hourly schedule and existing `ADMIN` manual trigger to the REST-only path and ends writes to the old webhook collection state.
Rollback stops the M3 schedule, restores the C2 current pointer to the last verified complete generation, then disables C1 REST generation; it does not restore webhook credentials or OAuth/PAT fallbacks.

### Public repository collection outside the organization — OAuth App client ID/secret Basic Auth

- Pros: a credential without expiration management.
  REST documentation allows OAuth Apps to read public data at up to 5,000 requests/hour using client ID/client secret in an HTTP Basic Auth header ([Rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)).
- Cons: documented for REST only; GraphQL v4 does not accept OAuth App client ID/secret Basic Auth and requires a bearer token tied to an actual authenticated identity.
  This extension uses GraphQL for discovery and REST for details, so choosing an OAuth App would still require a separate PAT for GraphQL, splitting credentials into REST and GraphQL credentials.
- **Rejected:** adding a PAT for GraphQL eliminates the only rationale, “no expiration management,” leaving the net cost of two credentials.
  `lane-graphql` overturned the choice after confirming during discovery-client implementation that GraphQL v4 does not support OAuth App Basic Auth (2026-08-04).
- Evidence recorded during the investigation (retained for traceability): the method deprecated on 2021-05-05 sent client ID/client secret as **query parameters** (`?client_id=&client_secret=`, `?access_token=`); **HTTP Basic Auth headers were not deprecated**.
  Many sources conflate the two and describe both as deprecated, so the precise distinction was recorded during evaluation.
  Had this option been adopted, a new App separate from the student-login `GITHUB_OAUTH_*` App would have been registered to isolate collection from login-secret rotations.
  The final PAT choice meant that registration plan was not executed.

## Consequences

### Enables

- #121 can implement the Repository Operations App installation-token client and durable worker.
- The Collection App performs one backfill for new repositories and incrementally collects only changes beyond endpoint-specific safe frontiers for existing repositories on hourly runs and the `ADMIN` manual trigger, updating cumulative facts/aggregates.
- The Collection App installation token can read organization repository metadata, default-branch commits, all-state pull requests, published releases, and all-state issues, with no write permissions.
- Platform-managed repositories map to existing `Repository` relations, while unmapped organization repositories are handled without fake program/team relations.
- #125 invokes Repository Operations App publication only through a separate staff/admin action after all required milestones are approved.
- Approval-time collaborator snapshots prevent semantic drift between team changes and worker delays.
- Credentials/installations for organization-wide REST reads are separated from platform-managed repository write/admin access.
- Actual commit/PR/release activity from public repositories where students work outside the organization can be collected through the same REST detail path as organization repositories.
  GraphQL is used only for discovery of the target repository list.

> **2026-09-24 amendment (#1133).**
> “Hourly runs and the `ADMIN` manual trigger” above now describes three triggers, not two.
> When an application-side repository URL association actually changes and commits, `CollectionSchedulerService.collectRepository` collects that single repository in a one-shot immediately after commit (`CollectionSyncService.runRepository`).
> This one-shot runs under the same scope lease as that repository’s sweep.
> If the hourly cron competes with it for the lease, that scope skips one tick.
> If the process restarts between persistence and execution, the repository falls back to the next hourly sweep.
> Skip conditions (not a collection target, not `PRESENT`, unknown default branch, or private outside the organization) are covered together by the §6/§10 amendment in [ADR-010](ADR-010-contribution-tracking-context.en.md).

### Costs / trade-offs

- Operate separate role-specific App registrations/private keys in test and production and obtain organization-owner approval for each.
- Because the Repository Operations App uses `Only select repositories`, existing platform-managed repositories must be selected explicitly at initial installation.
- Because the Collection App uses `All repositories`, new organization repositories are automatically included in collection.
- Observe installation revocation, permission changes, and token expiration as operational state.
- Until live smoke is complete, do not claim that actual GitHub integration for #121 or Collection REST cumulative/incremental collection is complete.
- Outside-organization public repository collection requires issuing and operating a third GitHub credential (service-account fine-grained PAT, environment key `GITHUB_PUBLIC_READ_TOKEN`) with the same secret-handling classification as existing App private keys.
- Unlike installation tokens, PATs are long-lived credentials whose expiration and rotation the service must manage; record expiry dates and rotation owners in operations documentation and explicitly fail closed when absent/expired rather than silently skipping.
- Contributions cannot be fully attributed from commits alone; commits whose emails are not registered with GitHub remain unattributed in rankings (PRs/releases are primary signals).

### New constraints

- The #119 outbox payload must contain the approval snapshot in `collaboratorGithubLogins`.
- #121 uses the outbox snapshot, not the current Team relation, as the authoritative invitation list.
- #121 uses only the Repository Operations App, and Collection generation uses only the Collection App.
- Neither path records actual credentials, headers, or raw REST responses in logs or the DB.
- Handling unmapped organization repositories must not invent program/team mappings.
- Publication is a #125 staff/admin action separate from review approval; do not automate it or grant students organization-wide visibility write access.
- The student read-only collection App in #15 is post-pilot and does not reuse either organization App’s permissions.
- Enable outside-organization public repository collection (introduce code creating `EXTERNAL_PUBLIC` rows) only after revising the GitHub activity consent document (`apps/frontend/public/policies/github-activity/`) and increasing `CONSENT_POLICY_VERSION`.
  Even the latest live document (`2026-08-11.html`) only says that organization repository activity enters public ranking aggregates regardless of visibility; automatic discovery of personally owned repositories outside the organization remains disabled until a separate consent revision.
  The 2026-08-11 correction replaces the originally cited `2026-07-21.html`, which was already stale when this sentence was committed; see the correction in “Consent-scope gate” above.
  This constraint does not block merging schema, discovery clients, or REST wiring; it blocks only activation (registering/wiring automatic discovery as a provider).
- Outside-organization public repository collection uses only a fine-grained PAT issued by a service account (the single `GITHUB_PUBLIC_READ_TOKEN` environment key shared by REST/GraphQL), not the student-login `GITHUB_OAUTH_*` App or student access tokens.
- Discovery (GraphQL `contributionsCollection`) uses the service-account PAT, not installation tokens, because installation-token access to top-level GraphQL fields is not established in documentation (unverified).
- The PAT for outside-organization public repository collection does not restore the “webhook/OAuth/PAT organization collection authority” removed by C2.
  C2’s scope is organization repository current-pointer authority, and this PAT is a separate authority outside that scope (public repositories outside the organization).
  The Separation of authority section in [`apps/backend/src/github/AGENTS.md`](../../apps/backend/src/github/AGENTS.en.md) is the current authoritative source for the three credentials’ separation.

## References

- [Issue #120: GitHub App integration spike/ADR](https://github.com/JNU-SWCU/oss-hub/issues/120)
- [Issue #15: student-installed read-only App](https://github.com/JNU-SWCU/oss-hub/issues/15)
- [Issue #36: organization repository collection/visibility boundaries](https://github.com/JNU-SWCU/oss-hub/issues/36)
- [Issue #119: application approval and durable outbox](https://github.com/JNU-SWCU/oss-hub/issues/119)
- [Issue #121: repository provision worker](https://github.com/JNU-SWCU/oss-hub/issues/121)
- [Issue #123: history of webhook collection](https://github.com/JNU-SWCU/oss-hub/issues/123)
- [Issue #125: staff review and separate publication](https://github.com/JNU-SWCU/oss-hub/issues/125)
- [Issue #205: GitHub App live smoke approval](https://github.com/JNU-SWCU/oss-hub/issues/205)
- [GitHub REST repositories endpoints](https://docs.github.com/en/rest/repos/repos)
- [GitHub REST commits endpoints](https://docs.github.com/en/rest/commits/commits)
- [GitHub REST pull requests endpoints](https://docs.github.com/en/rest/pulls/pulls)
- [GitHub REST collaborators endpoints](https://docs.github.com/en/rest/collaborators/collaborators)
- [GitHub REST repository invitation endpoints](https://docs.github.com/en/rest/collaborators/invitations)
- [GitHub App authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/about-authentication-with-a-github-app)
- [Authenticating as a GitHub App installation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)
- [Generating a GitHub App JWT](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app)
- [Generating an installation access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
- [Installing a GitHub App](https://docs.github.com/en/apps/using-github-apps/installing-a-github-app-from-a-third-party)
- [GitHub REST API rate-limit troubleshooting](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api)
- [Rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [Managing your personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [Choosing permissions for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)
- [GitHub Terms of Service](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)
- `.omc/plans/github-repository-unification.md` (internal planning document, Korean; §4’s collection design is the source of this amendment)

## Changelog

- 2026-09-24: #1133 PR2 (collection immediately after repository URL linking) made the “hourly runs and the `ADMIN` manual trigger” sentence under “Consequences → Enables” outdated, so a dated amendment was added there without deleting the original sentence.
  A third trigger now calls `CollectionSchedulerService.collectRepository` to collect only the repository whose URL association actually changed and committed, immediately after commit rather than waiting for the hourly sweep.
  This one-shot uses the same scope lease as that repository’s sweep.
  If the hourly cron competes with it for the lease, the scope skips one tick.
  If the process restarts between persistence and execution, collection falls back to the next hourly sweep.
  The corresponding §6/§7/§10 amendment in [ADR-010](ADR-010-contribution-tracking-context.en.md) was updated in the same PR.
- 2026-08-19: added an amendment broadening “GraphQL is for discovery only,” retaining the original paragraph.
  As ADR-010 moves ranking to the person axis, GraphQL serves person-axis metrics (`contributionsCollection` + `repositories(star)`) as well as discovery.
  Credentials remain the same single service-account PAT, `GITHUB_PUBLIC_READ_TOKEN`; public-only collection, no storage of student access tokens, and the token-pooling prohibition are unchanged.
- 2026-09-13: moved the authoritative credential split from a pending update of the retired `collection/AGENTS.md` to the Separation of authority section in [`apps/backend/src/github/AGENTS.md`](../../apps/backend/src/github/AGENTS.en.md).
  The Purpose quotation in the 2026-08-04 changelog remains as a historical record.
- 2026-08-11: corrected two stale references in “Consent-scope gate” and “New constraints” that called `2026-07-21.html` the “currently live consent document.”
  Even when these two passages were committed (`464c7b11`, 19:39), `6ff4ccb3` (19:22) had already raised `CONSENT_POLICY_VERSION` to `2026-08-04`.
  The `docs/ranking-exposure-policy` PR republished the consent document as `2026-08-11` and raised `CONSENT_POLICY_VERSION` accordingly, so both references were corrected to that latest version.
  **The correction is limited to the reference version strings**; the substance of the gate—automatic discovery of outside-organization public repositories stays disabled until a separate consent revision—remains unchanged.
  The `2026-08-11` consent amendment concerns organization repository aggregation (all registered users displayed and private organization activity included in public rankings), not the separate matter of enabling automatic discovery of personally owned public repositories outside the organization.
- 2026-07-21: recorded authentication, minimum permissions, tokens, the then-current webhook, and follow-up ticket contracts for organization automation Apps as Proposed under Issue #120.
- 2026-07-21: following PM decisions in Issues #36 and #120, separated the organization-wide read Collection App from the selected-repository write Operations App and accepted the pilot collection, ownership, and public boundaries.
- 2026-07-22: recorded the Collection App’s `Pull requests: read` permission and the then-current separation of REST-read and webhook smoke under Issue #205’s conditional approval.
- 2026-07-25: changed Collection App authority to REST-only organization-wide atomic current-state generations without webhooks, finalizing permissions, cadence, incomplete limits, E1 smoke, C1/C2/M3 cutover, and rollback without changing the Repository Operations App write contract.
- 2026-07-30: moved GitHub App private-key injection from environment strings to secret-file paths.
  Environment values appear in plaintext in `docker compose config`, `docker inspect`, and process environment dumps, so `Collection App` and `Repository Operations App` private keys are read from host secret files, following `SECRETS_DIR=/var/lib/oss-hub/secrets`, `jenkins:1000`, `2750` setgid, file `0640`, and Compose v5.3.1’s host ownership/mode propagation behavior.
  Do not put `uid`/`gid`/`mode` in Compose; retain legacy `GITHUB_*_APP_PRIVATE_KEY` for rollback safety during the two-stage deployment from R1 compatibility to R2 activation.
- 2026-07-31: replaced hourly organization-wide full-history generations with the organization-wide cumulative/incremental collection contract.
  Specified cumulative unique commit `(repositoryId, sha)`, PR `(repositoryId, githubPullRequestId)`, and release `(repositoryId, githubReleaseId)` metrics; endpoint-specific safe frontiers and exceptional repository-only complete scans on disconnected history/release-probe changes; nullable exact-request ETags (`2022-11-28` fingerprint); stored/discarded field inventory; revocation of public exposure based on complete/partial inventories; serial rate budgets and durable continuation cursors; and one-time backfill, parity checks, atomic cutover, one-release retention, and separate removal of the previous generation.
  Corrected the previous “Do not retain private repository identifying information” wording by separating internal DB storage from public exposure, whose conflation had conflicted with actual implementation.
- 2026-08-04: added collection of public repositories outside the organization explicitly registered by students.
  Based on GitHub’s official documentation that installation access tokens cannot access repositories outside their installation scope, introduced a collection-only GitHub OAuth App (client ID/client secret HTTP Basic Auth, separately registered from the student-login `GITHUB_OAUTH_*` App) as a second credential.
  Corrected a common misunderstanding by stating that HTTP Basic Auth headers were not the method deprecated on 2021-05-05; query parameters were.
  GraphQL `contributionsCollection` is used only to discover repository lists; subsequent commit/PR/release details reuse the existing REST path exactly as organization repositories do, giving external repositories the same fact rows.
  Kept public-only collection and no storage of student access tokens, and reconfirmed the token-pooling prohibition in GitHub Terms of Service Section H.
  Whether installation tokens can query top-level GraphQL fields for users outside the installation scope (`user(login:)`, etc.) was not established in documentation (unverified), so discovery also reuses the collection-only credential instead of installation tokens, removing dependence on that unknown.
  Recorded in the field inventory the inability to attribute commits with unregistered emails, and specified the ranking interpretation rule that PRs/releases are primary attribution signals and commits are secondary.
  The existing field inventory and private-data non-storage principle were unchanged.
- 2026-08-04: corrected the outside-organization public repository credential introduced above **from a collection-only OAuth App (client ID/client secret HTTP Basic Auth) to a service-account fine-grained PAT**.
  Evidence: `lane-graphql` confirmed during discovery-client implementation that GitHub GraphQL v4 does not accept OAuth App client ID/secret Basic Auth; it is documented for REST only, whereas GraphQL requires a bearer token tied to an actual authenticated identity.
  This extension needs both REST (detailed collection) and GraphQL (discovery), so choosing an OAuth App would still require a separate PAT for GraphQL and split credentials into two.
  The only reason for considering an OAuth App—“no expiration management”—would disappear, leaving the net cost of two credentials, so it was not adopted.
  The evaluation/rejection rationale and misconception correction (the 2021-05-05 deprecation affected query parameters, not Basic Auth headers) were preserved under “Public repository collection outside the organization — OAuth App client ID/secret Basic Auth” in “Alternatives considered.”
  The new credential is one service-account-issued fine-grained PAT shared by REST and GraphQL, based on “Tokens always include read-only access to all public repositories on GitHub” ([Managing your personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)).
  Fixed the environment key as `GITHUB_PUBLIC_READ_TOKEN`, replacing “to be determined in the implementation PR.”
  Because the service must manage PAT expiration and rotation itself, unlike installation tokens, specified the mitigations: issuance through a project-office service account (no personal accounts, to avoid collection interruption on departure and public-repository real-name exposure), recording expiry dates and rotation owners in operations documentation, and explicit fail-closed rejection when absent/expired (no silent skips that leave rankings at zero without anyone knowing).
  Retained all records that installation scope is the fundamental reason for a second credential, GraphQL is discovery-only, top-level GraphQL access with installation tokens is unverified, student access tokens are not stored, and ToS Section H was rechecked.
  This correction changes only the credential type.
  The ADR-003 DEC-42 amendment is independent of credential type and unaffected.
- 2026-08-04: added the **“Consent-scope gate”** section following an audit.
  Recorded with file/line evidence that the live GitHub activity consent document referenced by `CONSENT_POLICY_VERSION` (`apps/frontend/public/policies/github-activity/2026-07-21.html:14-18`) explicitly said, “Personally owned repositories are not collection targets under this policy,” and identified the conflict with this ADR’s design collecting exactly those excluded repositories.
  Described the exposure path using the fact that `GET /ranking` is a public endpoint without an authentication guard and `RankingService` prioritizes real-name display (`ranking.controller.ts:12,16`, `ranking.service.ts:110-111`).
  Added a New constraint allowing activation of outside-organization public repository collection (code creating `EXTERNAL_PUBLIC` rows) only after revising the consent document and increasing `CONSENT_POLICY_VERSION`, because re-consent cannot undo already-exposed information.
  Explicitly distinguished blocking **activation** from blocking **merges** of schema/discovery-client/REST wiring, based on the structurally inert pipeline: `CollectionDiscoveryClient` was not registered as a provider in any module, and no scheduler called `CollectionSyncService.runExternal()`.
  Left unresolved whether to revise the existing consent wording or add a separate opt-in, since that is a program-operations policy decision.
  Separately recorded that the policy to standardize public display on GitHub nicknames was not yet implemented, and that implementing it would mitigate real-name-first exposure independently of the consent revision.
  This is the decision called “D3” in `.omc/plans/github-repository-unification.md` §11, distinct from “D3 | delete `Repository`” in §7 of the same document; note the duplicate identifier.
  Implementing D3 itself was outside this amendment’s scope, and ADR-003 DEC-42 was unrelated.
- 2026-08-04: added a scope-distinction paragraph to “Selected credential” after feedback that the Purpose statement in `apps/backend/src/collection/AGENTS.md`—“webhook/OAuth/PAT collection paths were removed by C2 (#151, ADR-006)”—could appear to contradict the service-account PAT introduced here for public repositories outside the organization.
  Directly rechecking C2’s wording in “cutover and rollback” under “Alternatives considered” (“C2 ... makes REST complete generation the sole current-pointer authority and removes the Collection webhook URL/event subscriptions/secret,” and “rollback ... does not restore webhook credentials or OAuth/PAT fallbacks”) showed that C2 removed **the current-pointer authority of the Collection App reading organization repositories within the `JNU-SWCU` installation scope**, not the PAT credential form in all contexts.
  The Purpose paragraph in `collection/AGENTS.md` itself scoped collection to “all repositories within the organization installation scope (excluding outside-organization/personal-account repositories),” so external collection was never covered.
  The new PAT is therefore a new authority in a separate scope that C2 did not address, not a superseding reversal of C2; this distinction was added explicitly to “New constraints.”
  Organization repository current-pointer authority remains solely the Collection App installation token (REST reconciliation), unchanged.
  Recorded that `collection/AGENTS.md` needed updating alongside this ADR because its Purpose paragraph did not yet make the distinction explicit; it was not edited directly here because it belonged to the `collection` module’s owning lane.
- 2026-08-04: directly rechecked the judgment against **the original Issue #151**, not just this ADR’s internal wording, with one `gh issue view 151 --comments` call and no further API calls to conserve rate limits.
  The original scope of #151 (“Backend: periodic GitHub repository collection scheduler”) was scheduling organization repository batch collection using the pre-GitHub-App authentication path (collection.service.ts/github-api.client.ts, based on `CollectionRun`/`GithubRawObservation`), explicitly excluding App migration with “GitHub App migration belongs to #120. This ticket keeps the current authentication method.”
  Subsequent comments expanded the scope to GitHub App REST-only migration, and the last comment explicitly called C2 **“retirement”**: “Actual Collection App installation, REST-only collection... after C1 confirmation we will proceed with C2 retirement.”
  C2 thus retired the existing webhook/OAuth/PAT organization-collection paths and consolidated them into Collection App installation-token REST-only collection; outside-organization/personal-account public repository collection did not appear in #151 at all, originating later in `.omc/plans/github-repository-unification.md`.
  This evidence, the ADR’s “The Collection App’s only collection authority is ... do not run webhook, OAuth, or PAT paths alongside it or use them as fallbacks” (explicitly about the Collection App), and “Repositories outside the organization and personally owned repositories are outside this scope” all support **option 1 (scope clarification)**, not option 2 (blanket supersession).
  Added explicit statements that “Stored/discarded field inventory” and “Public exposure and complete/partial inventories” apply identically to `EXTERNAL_PUBLIC` rows regardless of `source`: introducing a PAT neither relaxes nor expands the forbidden-field list or public fail-closed/partial-inventory rules.
  PAT values, including example strings, were not included in this or any other amendment, preserving the constraint that secrets belong only in gitignored stores.
- 2026-08-20: **performed the follow-up migration promised in item 5 of “One-time transition to cumulative storage and retention of the previous generation,” removing all 8 old generation tables (`Canonical*`)**.
  The original body remains; this note only records fulfillment of the contract in items 4/5.
  Item 4 retained old generation tables read-only for rollback for one release after cutover, and item 5 required their later removal through a separately tracked migration, not the cutover itself.
  `20260820000000_drop_canonical_generation_tables` is that migration.
  Removal had three grounds: (1) the cutover finished many releases earlier, so the “one release” retention window had long expired; (2) repeated production measurements showed 0 rows in all 8 tables, leaving no “last successful generation” of the kind item 4 defined as the rollback target and therefore nothing retention protected; and (3) rollback reference readers had been removed in a preceding commit, and the writer (`CollectionReconciliationService`) plus cutover orchestration (`CollectionCutoverService`/`CollectionGenerationImportService` and their CLIs) were removed in the same commit, leaving zero references.
  The 8 tables formed one FK cluster rooted at `CanonicalCollectionRun`, so partial deletion was not possible; a single migration dropped the whole cluster child-first and also removed the `CanonicalCollectionRunStatus` enum used only by those tables.
  **The rollback contract itself is unchanged**: the code path restoring “the last successful generation as current” in item 4 no longer exists, and rollback is now a purely operational procedure of redeploying the previous release and restoring a backup (a full backup exists at deployment time).
  `CollectionCutoverLease` (the quiesce gate) and legacy observation tables `CollectionRun`/`GithubRawObservation` were outside this removal and remain.
- 2026-09-24: added `Issues: read` to Collection App permissions for #1133 issue collection, and documented the issue endpoint, unique key, stream rules, and stored fields (`(repositoryId, githubIssueId)`, event time, no title/body storage).
  `GET /repos/{owner}/{repo}/issues` requires `Issues: read` on installation tokens (GitHub App permissions documentation).
  An unauthenticated call confirmed that the list endpoint returns `200` containing only pull requests even when issues are disabled, not `410`; individual issue lookup returns `410`, so `410` handling is defensive.
  Each page costs 1 core rate-limit request; because the list includes PRs, initial backfill needs more pages than the PR stream.
  The organization owner must approve the installation’s new permission request before organization issues can be collected.
  Because the storage table accumulates one row per observed issue, it is named `GithubIssueHistory`, ending in `History` rather than `Fact` per [`data-modeling.md`](../rules/data-modeling.en.md) §4; renaming the three sibling `Collection*Fact` tables is a separate PR.
- 2026-09-26: following #1133, added to the field inventory the “outside contributor counts” whose storage ADR-009 had deferred, now stored in `GithubRepositoryOutsiderContribution` (one row per team repository, overwritten on each collection).
  Store only commit/PR/issue counts within the program period, counting context (application ID/program ID/period), and observation time; no author identifiers.
  Readers show the values only when that context matches the current association; relinking a repository to another team application hides counts until the next collection recounts them.
  Once an ended program has been counted once after its end, do not recount it, avoiding backward traversal of post-end PRs/issues on every sweep.
  Commit counts use GraphQL `history(since:, until:) { totalCount }` (no nodes, 1 point), minus team-member commit facts in the same period.
  PRs/issues use the existing list endpoints up to the period-start cursor, counting only in memory authors who are neither current team members nor bots (`[bot]`).
- 2026-09-27: #1453 removed the administrator route for registering external repositories by student (`POST /api/v1/admin/collection/discover-external`, `CollectionExternalDiscoveryService`, and the GraphQL discovery query).
  Its 2026-08-04 purpose was to include students’ outside-organization activity in repository-axis rankings, but the 2026-08-19 shift to person-axis rankings (`contributionsCollection` totals) eliminated that purpose; the remaining effect was hourly collection of students’ personal repositories unused by any screen.
  The same change narrowed collection of outside-organization repositories (`EXTERNAL_PUBLIC`) to **while linked to a program application**: stop collecting when changing repositories or deleting a program/team removes the association.
  Organization repositories remain collected regardless of association because they belong to the project office.
  The service-account PAT (`GITHUB_PUBLIC_READ_TOKEN`) remains in use for person-axis queries and REST details of linked outside-organization repositories.
  Retain the body above as the record from its time and narrow the scope only through this note.
