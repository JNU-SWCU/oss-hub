---
slug: ADR-011-query-filter-type-boundary
date: 2026-08-20
author: GoBeromsu
status: Accepted
references:
  - ADR-003-backend-architecture
  - ADR-004-REST-API-규격
  - ADR-010-contribution-tracking-context
refines:
  - ADR-010-contribution-tracking-context
---

# ADR-011: Query Filter Type Boundary — Do Not Send Sentinel Strings as SQL Values

[한국어](ADR-011-query-filter-type-boundary.md) | **English**

English translation of the [Korean source](ADR-011-query-filter-type-boundary.md).
The Korean document remains authoritative.

## Status

Accepted

## Date

2026-08-20

## Context

Both `GET /ranking` and `GET /dashboard/staff/insights` receive `?year=` over HTTP.
Query strings are always strings, so `all` and `2026` arrive in the same field.
The ranking domain already combines them in `RankingYear = number | "all"`, but passes only `currentYear?: number` to the port — omitting the field for all time (`getPublicRankingMetrics` in `ranking.service.ts` and `yearBounds` in `public-ranking.repository.ts`).
Building the student activity screen with the same `?year=` created the temptation to carry that string unchanged into SQL or Prisma `where`.
The question was simple: **is mixing `"2026"` and `"all"` as strings in a query actually dangerous?**

This document records that judgment and the type boundary fixed on 2026-08-20.
[ADR-010](ADR-010-contribution-tracking-context.en.md) §1 remains authoritative for the ranking's **default year (current year when absent)**.
This ADR defines only **the type in which a value reaches persistence**, not its default.

## Verdict — `"all"` is not an injection payload in the current paths

The current public ranking read uses Prisma `findMany` and `date: { gte, lt }`.
When `currentYear` is present, an integer is used to construct Asia/Seoul year boundaries; when absent, no period condition is added.
User strings are not concatenated into SQL text.
Therefore, **sending `"all"` alone does not dump tables or invert predicates in the ranking/insights paths deployed today.**

The danger is not the `"all"` token itself, but leaving the filter domain as strings so a subsequent change can concatenate them into a query.
The following aligns that claim with primary sources.

| Failure mode | What actually happens | Injection (CWE-89)? |
| --- | --- | --- |
| Values are bound in Prisma tagged `$queryRaw` / `findMany` | The engine separates SQL from data. If `'all'` reaches an integer/date field, the type rejects it | No |
| Bound `'all'` enters an integer field | PostgreSQL `22P02` `invalid_text_representation` — `"all"` is not an integer | No. Availability/500 failure |
| Unquoted `${year}` is concatenated to produce `year = all` | `ALL` is a reserved SQL word for quantified comparison (`expression operator ALL (...)`). This causes a syntax error or unintended `ALL` semantics | Not a dump on its own. An entry point for altering query intent |
| Raw HTTP input (`2026 OR 1=1`, `2026';--`) is concatenated into a `$queryRawUnsafe` string | Data becomes a command | **Yes. This is CWE-89** |
| A string is constructed through a function call rather than a tagged template, such as ``$queryRaw(`... ${user}`)`` | Prisma also considers this usage injection | Yes |

Sources are linked below.
In summary, **the current port contract, passing only validated numbers and omitting the field for all time, is safe.**
The dangerous design is allowing `year: string` or `number | "all"` to remain alive across the persistence boundary.

## Decision

1. **HTTP may receive strings.**
   The wire values for `?year=` are `all`, a four-digit year, or blank/absent.
   Subsets use query parameters as specified in ADR-004.
2. **Separate the types as soon as the controller/parser finishes.**
   Application values are `{ kind: "all" } | { kind: "calendar"; year: number }` or the port's existing `currentYear?: number` (omitted for all time).
   Do not pass `"all"` and `"2026"` downward as the same `string`.
3. **Persistence/ports receive a number or omit the condition.**
   `currentYear?: number` in `COLLECTION_READ_PORT.getPublicRankingMetrics` is that contract.
   Do not put the `"all"` token, year strings, or `year: number | "all"` into Prisma `where` or raw SQL values.
4. **Use tagged `$queryRaw` / `Prisma.sql` as the default for raw SQL.**
   `$queryRawUnsafe` allows only compile-time SQL with `$1` bindings.
   Do not concatenate user strings into SQL text.
   Table and column names cannot be bound as parameters, so do not use user input as identifiers; use only an allowlist plus `Prisma.raw`.
5. **The same parameter name does not promise the same default.**
   An absent ranking `year` means the current year (ADR-010 §1).
   An absent, blank, or `all` `year` in student activity means all time.
   Defaults are endpoint contracts; do not copy them from sibling endpoints.

The canonical student activity implementation is `parseInsightsYearQuery` and `rankingYearFilter` in `staff-insights-year.ts`.

## Antipatterns identified today (2026-08-20)

As ADR-007 names the fallback fabrication antipattern, name the two patterns blocked that day.
Cite this section when the same patterns recur.

### AP-2026-08-20-1 — Sentinel string as a value

**Prohibited.**
Carrying a filter as `type Year = number | "all"` or `year: string` into persistence and using it as input to `WHERE year = ${year}` / ``$queryRawUnsafe(`... ${year}`)``.

Why this is dangerous:

- If raw HTTP input bypasses the parser once, it becomes exactly CWE-89 — external input forms part of an SQL command.
- `"all"` looks like a value, but is the `ALL` keyword in PostgreSQL.
  Concatenated without quotes, it is interpreted as syntax rather than data.
- Even when bound, `"all"` in an integer/date field fails with `22P02`; the screen then sees a 500, not “all time.”

**Correct design.**
The parser separates a discriminated union, omits the condition for all time, and passes only a `number` year to the port.
Ranking already does this at the port call; insights starts this way at the type level.

### AP-2026-08-20-2 — Same query name, same default

**Prohibited.**
Making faculty/staff activity default to the current year merely because public ranking interprets absent `?year=` that way (ADR-010 §1).

Why this is wrong:

- The name is the same, but the question is not.
  Ranking asks “How much have I contributed this year?”; activity asks for an overview of accumulated contributions and participation by registration department.
- Inheriting defaults from a sibling reproduces the mismatch where the sidebar points to `all` but the body shows the current year — a kind already observed in the ranking shell.

**Correct design.**
State the screen's absent-value default as a one-line contract in its parser, and lock down absent, `""`, `all`, and `YYYY` separately in tests.
For insights, absent = `all`; all-time URLs omit `?year=` so the address agrees with the server default.

## Alternatives considered

### Allow `number | "all"` through the repository boundary

- Pros: Reuses the ranking domain type unchanged.
- Cons: `"all"` looks like a value and is easy to interpolate in a subsequent change.
  Coercing a string at a call site when the port type is `number` removes compile-time protection.
- **Rejected:** Keep convenience in the parser; only numbers or omission cross the persistence boundary.

### Compare strings in SQL, such as `year IN ('all', $1)`

- Pros: Makes it tempting to assume one query can represent both all time and a specific year.
- Cons: The year column is integer/date.
  `'all'` is a branching token, not a comparison value.
  Placing a branch token in the same `IN` list as row values causes a type error or opens an injection surface when lowered to a text column.
- **Rejected:** All time is the branch that does not construct a `WHERE` condition.

### Validate input but keep the string type

- Pros: A regex allowlist (OWASP Option 3) alone blocks many payloads.
- Cons: Allowlists are supplementary.
  If the type remains `string` after validation, it can still feed raw SQL interpolation.
  OWASP's first recommendation is parameter binding, not regex alone.
- **Rejected:** Apply the allowlist in the parser and use types to enforce the boundary below it.

## Consequences

### Enables

- Student activity, ranking, and future year filters share the same persistence contract — number or omission.
- The fact that `"all"` is a reserved SQL word is a judgment documented here, rather than assumed code-review knowledge.
- Do not conflate default mismatches with security issues.
  Defaults are product contracts; this ADR owns the type boundary.

### Costs / trade-offs

- There is an additional layer between the HTTP DTO's `year?: string` and the application scope type.
- The ranking domain's `RankingYear = number | "all"` may remain for cache keys and response envelopes.
  It does not violate this ADR as long as `"all"` is not passed to the port.
  Migrating the domain type to a union is not a mandatory follow-up.

### New constraints

- New `?year=` parameters (or equivalent period filters) separate scope in the parser, with tests fixing the absent-value default and rejected strings (mixed values such as `2026;…`).
- A PR concatenating user input into `$queryRawUnsafe` violates this ADR.
  Static SQL plus bindings remains allowed, as in the existing canonical path.
- The source of departments for activity classification is the registration profile (`UserProfile.department` / legacy `User.department`).
  Independently of public ranking exposing the same field (ADR-010 D15 amendment), insights reads the profile directly to count students without ranking rows as well.
  It does not request real names (`includeRealName` omitted).

## References

Only primary sources are listed.
Blog summaries are not used as evidence.

- [CWE-89: Improper Neutralization of Special Elements used in an SQL Command](https://cwe.mitre.org/data/definitions/89.html) — defines the weakness where external input becomes part of an SQL command.
  This ADR blocks its **entry point**: string filters reaching interpolation.
- [OWASP SQL Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html) — prepared statements / parameterized queries are the first recommendation.
  Input allowlists are the third, supplementary option.
  Escaping is not recommended.
- [Prisma: Raw queries](https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/raw-queries) — tagged `$queryRaw` templates bind parameters.
  The documentation explicitly warns of injection when concatenating `$queryRawUnsafe` strings.
  Identifiers (tables/columns) cannot be interpolated through `$queryRaw`.
- [Prisma Discussion #20132](https://github.com/prisma/prisma/discussions/20132) — a maintainer distinguishes safe `` $queryRaw`… ${x}` ``, `Prisma.sql`, and `$queryRawUnsafe('… $1', x)` from unsafe `` $queryRawUnsafe(`… ${x}`) ``.
- [PostgreSQL 9.25 Row and Array Comparisons — ALL](https://www.postgresql.org/docs/current/functions-comparisons.html#FUNCTIONS-COMPARISONS-ALL) — `ALL` is the quantified comparison keyword in `expression operator ALL (array|subquery)`.
  Concatenating the value `"all"` without quotes conflicts with that syntax.
- [PostgreSQL Appendix: SQL Key Words](https://www.postgresql.org/docs/current/sql-keywords-appendix.html) — `ALL` is reserved.
- [PostgreSQL Appendix: Error Codes — `22P02`](https://www.postgresql.org/docs/current/errcodes-appendix.html) — `invalid_text_representation`.
  Reading non-integer/date text (`all`) as that type is rejected with this code.
  This is a type error, not injection.

## Changelog

- 2026-08-20: New decision fixing the persistence type boundary for query filters and the two antipatterns identified on 2026-08-20.
  The ranking's default year (absent = current year) remains ADR-010 §1; the student activity default (absent = all time) is §Decision 5 here.
- 2026-08-20: After public ranking was amended to expose `department` (ADR-010 D15), corrected the constraint to state that insights reads registration profiles directly rather than using that field as its classification source.
  Activity metrics use the same sum of five metrics as ranking (commit, PR, issue, repo, and star).
