---
slug: ADR-009-own-repository-connection
date: 2026-08-05
author: GoBeromsu
status: Accepted
references:
  - ADR-006
refines:
  - ADR-006
---

# ADR-009: Authority and Collection Boundaries for Student-Owned Repository Connections (OWN)

[한국어](ADR-009-own-repository-connection.md) | **English**

English translation of the [Korean source](ADR-009-own-repository-connection.md).
The Korean document remains authoritative.

## Status

Accepted

> **2026-08-12 amendment**: In phase D of `#617`, `Repository` was consolidated into `GithubRepository`.
> Parts of this document describing `Repository` as a separate provisioning table (§3, “Changes during implementation,” and so on) now refer to the `applicationId`/`source` columns of `GithubRepository`.
> To preserve the decision record, the body remains unchanged and only this note is added.

> **2026-08-19 amendment — `OWN` remains; only ranking has been separated from this path.**
> Everything this ADR established — read-only connection, lightweight ownership verification, counting external activity toward program performance, and narrowing third parties at query time — **remains fully valid.**
> However, the 2026-08-19 amendment to ADR-010 means **public ranking no longer depends on external repository inclusion**: ranking reads the person dimension (`GithubUserActivityHistory`), so a student's yearly activity is aggregated even without connecting any repository.
> The meaning of `OWN` is therefore narrowed, not weakened: it now records “this repository is an output of this program” to generate metrics, timelines, and releases for ② program screens, which remains the sole purpose of `OWN`.
> The §4 boundary to `exclude third parties from collection` remains in force on the repository dimension.

## Date

2026-08-05

## Context

The application form offers two repository connection modes.

- `NEW` — on approval, automatically create a repository in the `JNU-SWCU` organization and invite students.
  **Implemented.**
- `OWN` — connect an existing project repository directly to the program.
  **Only the values are stored; there is no connection path.**

`repositoryConnectionMode` (enum `NEW|OWN`) and `repositoryUrl` are stored in `Application` and passed into the outbox provisioning event payload on approval.
However, the worker still creates a new repository inside the organization.
The `OWN` URL is parsed but unused.

This is not missing wiring.
**ADR-006 grants no authority outside the organization.**

- ADR-006 **Accepted** the decision that the technical owner of a repository is the `JNU-SWCU` Organization.
- The installation scope section and endpoint/minimum-permissions table include no write endpoints for repositories outside the organization.
- An installation token **structurally** cannot access repositories outside its installation scope.
- Both token providers and client paths hardcode the organization (`/repos/{org}/{name}`, `/orgs/{org}/repos`).

Code cannot create and exercise authority ahead of a decision.
That is why a decision is requested.

### This platform measures student contributions

This is where the decision's framing diverges.
We are building **records of individual students' open-source contributions**, not an activity dashboard for arbitrary repositories.
Missing that premise incorrectly reduces item 4 below to a presentation question.
It is actually a question of **what to collect**.

## Decision

### 1. Authority outside the organization — fix it as read-only

| Option | Gains | Losses |
| --- | --- | --- |
| **1-A. Read-only (proposed)** | No additional installation steps. The authority boundary remains intact | `OWN` cannot offer repository publication or collaborator invitations |
| 1-B. App installation on the student's personal account | The same functionality as `NEW` | A **new authority boundary** requiring an App with `Administration: write` on the student's personal account. Installation guidance, revocation handling, and least-privilege redesign follow |
| 1-C. Remove `OWN` | Simpler authority boundary | Students with ongoing projects lose a way to participate |

**Choose 1-A.**
`OWN` needs to aggregate the student's activity in the repository, not manage the repository on their behalf.
Address 1-B in a separate ADR only after the need is demonstrated.

Therefore, **do not expose** publication or collaborator-invitation controls for `OWN` repositories.
The UI must explain this difference to students.

### 2. Ownership verification — keep it lightweight

The initial concern was attaching someone else's popular repository and claiming its achievements.
With the collection filter in item 4, however, **someone with zero contributions receives zero credit**.
Attaching someone else's repository brings no gain, removing the incentive for abuse.

- At application time, check only URL format and **whether the repository is publicly accessible**.
- Do **not** require the owner account to match, to avoid blocking legitimate cases such as contributing to an organization repository.
- Submitting a release as a milestone deliverable is a separate dimension.
  Human judgment in submission review (`submission-reviews`) handles that path.

### 3. External activity counts toward program performance

Without counting it, there would be no reason to use `OWN`.
However, **retain** `Repository.source` so organization and external repositories remain distinguishable in data.

### 4. Third-party contributors — narrow at query time

This is the core of the ADR.

Current collection scans entire repositories through REST.

```text
/repos/{owner}/{repo}/commits?sha={branch}&per_page=100   ← no author filter
/repos/{owner}/{repo}/pulls?state=all&per_page=100
/repos/{owner}/{repo}/releases?per_page=100
```

- `CollectionCommitFact` / `PullRequestFact` / `ReleaseFact` persist `authorGithubId` and `authorGithubLogin` directly.
- `CollectionContributorYearAggregate` creates yearly rows for **every account** appearing in facts.
- Public ranking queries filter only `repository.visibility = PUBLIC`, not registration status.

This was harmless with organization repositories alone — everyone there is, by definition, a participant.
**The nature changes as soon as an external repository is connected.**
Our DB starts accumulating activity profiles of people who do not even know this platform exists.
A ranking display filter cannot prevent this.
Even if hidden on screen, the data is already stored on our side.

**The solution is not to write our own filter, but to have GitHub not send the data in the first place.**
GraphQL `history` accepts an `author` argument.

```graphql
repository(owner:$owner, name:$name) {
  ref(qualifiedName:$branch) {
    target { ... on Commit {
      history(author:{id:$authorId}, since:$since, first:100) { ... }
    }}
  }
  pullRequests(states:[OPEN,MERGED,CLOSED], first:100, orderBy:{field:CREATED_AT, direction:DESC}) { ... }
  releases(first:100, orderBy:{field:CREATED_AT, direction:DESC}) { ... }
}
```

#### Measurements (2026-08-05, free-tier personal token)

| Target | Total commits | Author-filter result | GraphQL cost | Equivalent REST requests |
| --- | --- | --- | --- | --- |
| `facebook/react` | 21,620 | 0 (no contributions) | **1 point** | Approximately 217 |
| `JNU-SWCU/oss-hub` | 1,377 | 940 (self) | **1 point** | Approximately 14 |
| Above + 100 PRs + 100 releases together | — | — | **1 point** | Approximately 20 |

- The filter actually works — all returned nodes have the specified account as author.
- GraphQL charges by **node count, not request count**.
  At 5,000 points per hour, this query shape allows **approximately 5,000 repository synchronizations per hour**.
- That is meaningful headroom on the free tier.
  Proceed without upgrading to a paid tier.

#### Conclusions by dimension

The metric model is **member activity → aggregated into team activity → aggregated into program activity**.
Member activity is the sole atomic unit, so there is no need for a concept of whole-repository activity.

Also, `TeamMember.userId` enforces a `User` FK, so **every team member is a registered user by definition**.
Author-scoped filtering therefore loses no team activity.
An unregistered contributor to an organization repository is not a team member; if they are not a team member, their work is not team activity in the first place.

**1. Team members — persist at individual granularity.**
For each repository, query only that team's members.
These are **this team's people**, not all platform users, so normally 1–5 queries.

**2. External contributors — retain only counts.**
“N external contributors · M commits.”
Do not store personal identifiers (login or githubId).
Preserve collaboration context without creating profiles of people who have not consented.

Preloading external contributors as prospective registrants was considered and rejected.
Because `history(author:)` retrieves the complete history without `since` for 1 point, **backfill at registration/joining provides the same convenience**.
Preloading adds no benefit, while storage grows with repository popularity (popular OSS has thousands of contributors) and adds the risk of an official Chonnam National University platform classifying and storing non-consenting people as prospective registrants.
Public availability of data and institutional collection, retention, and classification are different acts.

**3. Do not distinguish organization from external repositories.**
There is one rule.
Although the risks appear different, narrowing to team members loses nothing in either case.

**4. Preserve past contributions.**
Do not delete existing facts when a member leaves a team.
The policy does not delete `User` rows, so a historical fact's `githubId` continues to resolve to a name.
A contribution is a fact; leaving does not undo it.

**Filter PRs and releases at persistence time.**
GraphQL has no `author` argument for them either.
Do not use `search(query:"repo:X is:pr author:Y")`: its separate limit of **30 requests per minute** is more hazardous.
Repositories have hundreds of PRs/releases, so retrieving all of them has a different cost scale from tens of thousands of commits.

Routine PR collection preserves a `(createdAt, id)` tie frontier.
However, retain a versioned SHA-256 fingerprint of the team-member GitHub id set in `frontierSha` of the same PR stream; on a sweep where the fingerprint changes, ignore the tie frontier once to retrieve all PRs again.
This one-time repair backfill also persists PRs created before a new member joined.
After the fingerprint, facts, and new PR frontier are recorded in the same fenced transaction, subsequent sweeps return to incremental requests.
Existing READY rows lack fingerprints, so they perform one repair backfill for current members immediately after deployment.
Do not store raw member ids in this control marker.

**Do not create whole-repository metrics.**
Exposing totals would require retaining third-party data, exactly what this clause prevents.
If the scale of external contribution is needed, use the counts in item 2.

#### Track only the default branch

Collection reads only `defaultBranch` (`collection-sync.service.ts`).
This is a condition that makes the design work, not merely a limitation.

In open source, the contribution unit is a **merged PR**; merging places commits on the default branch — whether through squash or a merge commit, authorship is preserved, so `history(author:)` captures it.
Unmerged branch work is difficult to count as performance in the first place.

More importantly, **subtraction has one common baseline**.

```text
Total       = countDefaultBranchCommits(defaultBranch)
Member sum  = each member's history(author:) on defaultBranch
External    = Total − Member sum
```

If the total covered all branches while the member sum covered only the default branch, external counts would be inflated.
Passing the same `defaultBranch` to both avoids that mismatch.

For empty repositories where `defaultBranch` is `null`, skip collection without modifying the frontier so backfill occurs after the first commit.

#### When to backfill

Registration alone does not identify which repositories to read.
The trigger is the moment a repository becomes known.

| Event | Behavior |
| --- | --- |
| Registration | None — repository unknown |
| Joining a team / application approval | The member's **complete history** is populated in the next sweep (no separate trigger needed — see below) |
| `OWN` connection | Populate the user's **complete history** in that repository with one query |

Without `since`, **collection fills historical activity at once, not just activity since registration**.
At a cost of 1 point, retrospective collection is inexpensive.

**Do not add a separate trigger.**
`collection-sync.service.ts` rereads the member list on each sweep and retrieves each member's complete history without `since`, so new members are populated automatically in the next sweep.
`@@unique([repositoryId, sha])` prevents duplicates.
The same reasoning explains not using incremental collection here: complete history also costs 1 point, leaving no incremental benefit, and carrying less state produces fewer bugs.

Latency equals the sweep interval (default 1 hour, configurable through `COLLECTION_CRON_EXPRESSION`).

#### Existing assets

`collection-discovery.client.ts` **already implements** user-side `contributionsCollection` GraphQL.

Therefore, `OWN` connections need no new client.

```text
Student connects an OWN URL
  → Query repositories the student contributed to through the discovery client
  → Approve the connection if it appears in the list  ← resolves ownership verification in item 2
  → Subsequent synchronization queries only that student's activity with author-scoped queries
```

**Item 2 (ownership verification) is resolved for free.**
GitHub answers whether the student actually contributed to the repository, so we do not need to require owner identity matching.

#### Known limitation

`history(author:)` uses commit authorship, so it misses cases where rebase/squash leaves the student only as committer.
However, GitHub also does not count such commits as that student's contributions.
**Following GitHub's criteria preserves consistency.**

## Consequences

Implementation follows acceptance.

- **Switch commit collection to author-scoped GraphQL** — replace full REST pagination.
  The commit path in `collection-app.client.ts` is the target; retain PR/release paths but filter members at persistence time.
- **Acquisition-path selection** — choose the cheaper of per-author and full retrieval based on member and commit counts.
  If deciding is difficult, start by fixing external repositories to per-author queries.
- **Retrospective collection for new registrants** — pre-registration activity is empty.
  Decide whether to collect only from registration onward or retrospectively recollect.
  Author-scoped queries without `since` retrieve complete history for 1 point, making retrospective collection cheap.
- Add a connection-mode field to `Repository` to express **connected without being created**.
  The current schema cannot distinguish this.
- Limit the approval-reversal lock condition to `NEW`.
  `OWN` has no repository to create, so provisioning completion means something different.
- The `https://github.com/JNU-SWCU/{name}` URL invariant in `GET /repositories/me` causes the whole list to fail with an exception on external URLs.
  Connection-mode branching must be included in the same PR.
- Ranking/public project metrics change meaning from repository activity to member contributions.
  Values should be effectively unchanged for organization repositories; differences require investigation.

If rejected, remove the `OWN` option from the application form and decide separately how to handle the already stored `repositoryConnectionMode` and `repositoryUrl` columns.

## Alternatives considered

**Extend provisioning to attach external repositories.**
An installation token structurally cannot access out-of-scope repositories, so this does not work.
A personal-account installation must come first, which is the same decision as 1-B.

**Delegate only to the tracking layer (`collection-external-discovery`).**
External repository tracking already exists.
But the tracking layer has no way to associate an `Application`, so it cannot record that a repository is an output of a program.

**Persist third parties and filter only their display.**
Implementation is easier, but third-party activity remains in our DB.
Display rules can change at any time, and the data would already be there.
Filtering at collection prevents mistakes that are difficult to reverse.

## Follow-ups

The `OWN` connection path and collection boundary have been implemented and merged ([#669](https://github.com/JNU-SWCU/oss-hub/pull/669) · [#670](https://github.com/JNU-SWCU/oss-hub/pull/670) · [#671](https://github.com/JNU-SWCU/oss-hub/pull/671) · [#674](https://github.com/JNU-SWCU/oss-hub/pull/674)).
Commits use author-scoped complete history, releases use the full list on change, and PRs use a one-time repair backfill when the member fingerprint changes to include activity predating membership.

Remaining:

- Update ADR-006's “technical owner = Organization” clause with the `OWN` exception (read-only connection).
- The **storage location for external-contributor counts** (`Total − Member sum`) is undecided.
  Currently they are calculated and logged only.
  Create columns when a screen location is decided — do not speculatively create unused columns first.
  - Resolved 2026-09-26: the location is one line, “Contributions from non-team members,” in the faculty/staff team detail (#1133 follow-up).
    `GithubRepositoryOutsiderContribution` stores only commit, PR, and issue counts within the program period per team repository — see Changelog below.

### Changes during implementation

**The proposed connection-mode field was not added to `Repository`.**
`Application.repositoryConnectionMode` already exists and `Repository.applicationId` is `@unique`, so one join determines the mode.
Avoiding an extra migration simplifies deployment.

## Changelog

- 2026-09-26: Decided where to store external-contributor counts (#1133 follow-up).
  They power the faculty/staff team-detail line “Contributions from non-team members · Commit n · PR n · Issue n,” and `GithubRepositoryOutsiderContribution` overwrites one row per team repository on every collection.
  Commit count is this ADR's `External = Total − Member sum`, restricted to the program period — the total uses `history(since:, until:) { totalCount }` (no nodes, 1 point); the member sum counts current members' commit facts in the same period.
  Consequently, commits cannot distinguish bot commits or commits from email addresses unlinked to accounts.
  PRs/issues are already retrieved as lists (see “Filter PRs and releases at persistence time”), so collection reads through the cursor at the period start and counts in memory only authors who are neither current members nor bots.
  There is no list of people (the old faculty/staff screen's “Not linked to web participants”) — consistent with item 2's rule against profiling non-consenting people.
- 2026-08-19: Added an amendment noting that public ranking's move to the person dimension severed its dependency on `OWN` inclusion (without deleting the existing body).
  `OWN` connection remains intact as the metrics/releases path for ② program screens.
  The basis is ADR-010's 2026-08-19 amendment.
- 2026-08-09: To fix missing historical PRs for late-joining members in #683/QA28, added the contract to retain a member-set fingerprint in the PR stream, perform one repair backfill only on sweeps where the set changes, and then reuse the incremental frontier.
