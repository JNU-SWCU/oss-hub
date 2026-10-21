# Data Modeling Rules (Backend)

[한국어](data-modeling.md) | **English**

English translation of the [Korean source](data-modeling.md).
The Korean document remains authoritative.

This document applies when adding tables to `schema.prisma`, naming models and fields, or designing projections for public aggregates.
All of the rules below come from cases observed in this repository's actual schema.

## 1. Identify the model's actual reads, writes, and transaction owners

Do not infer concepts or writers from model names alone.
`GithubRepository` preserves both remote identity/observations and application associations.
Provisioning, inventory, OWN connections, publication, and purge each own different fields and changes.
Do not enforce one file per table; record the authorization, CAS, locks, and audit/outbox atomicity of each change.

The investigation must cover not only delegate names, but also transaction/db aliases, nested mutations, raw SQL, migrations, CLIs, and external readers.
An `rg` search is a starting point; zero search results mean neither zero production rows nor permission to remove anything.
Distinguish canonical records, projections, and compatibility copies, and check production rows, external consumers, and retention obligations before deletion.

The [ownership and relationship inventory for 45 models](../backend-model-ownership.en.md) records the grain, keys, relationships, writers/readers, retention, and public boundaries at the reference commit.
Code refactoring and physical schema changes are separate verification units.

## 2. Define row grain and relationships first

GitHub activity collection uses the following relationship axes.
Do not force programs, teams, applications, or documents into these three axes.

| Axis | Question answered |
| --- | --- |
| `repository ↔ user ↔ date` | Who contributed to which repository on which date? |
| `user ↔ year` | How active was that person on GitHub during a year? |
| `repository ↔ observation/event` | Which repository state was observed or changed? |

`Contribution(repositoryId, githubId, date)` and `GithubUserActivityHistory(githubId, year)` have different populations, keys, and sources.
Do not combine them by inventing a repository ID.
The person-axis writer iterates over ACTIVE registered users, upserts observations for the current year, and retains rows from previous years.
Having yearly rows does not mean that every observation appends an immutable event.

Program affiliation, participation during preparation, confirmed team membership, application revisions, submission status headers, and immutable review events also have different grains and lifetimes.
For JSON answers, message payloads, and audit metadata, first check the versioned document contract; do not split them into EAV or separate tables merely because they are JSON.

## 3. Explicit queries and response allowlists protect public boundaries

Choose between an external GitHub ID and an internal User FK based on the data's origin, affiliation, deletion, and retention semantics.
`GithubUserActivityHistory` preserves external githubId and githubLogin values, but the current person sweep targets ACTIVE registered users.
The absence of an FK does not make private JOINs impossible or guarantee rankings for unregistered users.

Public queries use explicit `select` projections in approved repositories and response allowlists.
Preserve field differences between public/STUDENT responses and ACTIVE STAFF/ADMIN responses, identical errors for private/nonexistent targets, and the timing of current authorization lookups.
Do not change this into fetching all private fields, such as names and departments, and deleting them afterward.

When copying display values, specify the source, update frequency, drift handling for partial updates, and retention semantics after account deactivation or disconnection.
Do not fill nullable legacy aliases by assuming they represent the same facts as new data.

## 4. Names express grain and mutability

- Distinguish snapshots that overwrite current state, immutable events, observed facts, and query projections.
  A time field or year key alone does not justify requiring `History` or prohibiting `Snapshot` and `Fact`.
- Use domain terminology and avoid unnecessary abbreviations.
  Use `Github*` to identify the external source when it matters.
- Keep `*Repository` for the persistence layer.
  Clarify each write/read responsibility rather than changing model names and class suffixes.
- Represent GitHub paths as `nameWithOwner`.
  Do not confuse them with a person's `name`.

When only a logical name needs changing, Prisma `@map`/`@@map` can preserve the physical name.
Handle physical renames, column removal, and FK additions in separate migrations after investigating generated clients, raw SQL, constraints/indexes, and external consumers.
Do not rewrite existing migrations.

For schema candidates, compare retaining the current design with the proposed change, and document the sequence expand → evidence-based backfill → reader/writer transition → equivalence verification → contract, along with lock cost, version coexistence, stop conditions, and backup/rollback.
Preserve production nulls and historical event relationships when their provenance is unclear; perform actual DB inspections, migrations, and deployments within a separately approved scope.

## 5. Establish external API assumptions through observation, not remembered documentation

Do not assert GitHub API behavior from memory.
Before incorporating a new query into a design, call it at least once to check response status, error type, and rate limit cost, and record the results in the design document.

An assumption that was actually overturned: the one-year window limit on `contributionsCollection(from, to)` is a hard `VALIDATION` error, not a recommendation; exceeding it causes the query itself to be rejected.
The design assumption that it was "not an explicit rule" failed on the first call.

Keep evidence public-safe: do not paste tokens, real names, or private repository identifiers (`docs/rules/security.md`).

---

This document extends [AGENTS.md Code Conventions](../../AGENTS.en.md#code-conventions--common-patterns) (the DB migration serialization rule) and [AGENTS.md Architecture & Data Flow](../../AGENTS.en.md#architecture--data-flow) (public query and response allowlist boundaries), and follows [ADR-003](../decisions/ADR-003-backend-architecture.en.md) (backend architecture).
[`pr-scope.md`](pr-scope.en.md) is the authoritative source for schema-change PR scope and decomposition criteria.
