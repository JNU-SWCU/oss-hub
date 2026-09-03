---
slug: 012-program-track-type
date: 2026-09-03
author: GoBeromsu
status: Accepted
references:
  - ADR-008-api-response-field-ownership
supersedes:
  - '#109 display/input only (ProgramCategory as public catalog axis)'
---

# ADR-012: ProgramTrackType replaces category in public API and authoring input

## Status

Accepted

## Date

2026-09-03

## Context

Issue #109 locked seven `ProgramCategory` values as the program type axis for authoring, apply templates, and public catalog metadata. Product direction now separates concerns:

- **Apply template binding** is owned by server-fixed `applicationTemplateKey` (`basic` for all newly authored programs).
- **Display/filter metadata** uses nullable `ProgramTrackType` (`CURRICULAR` | `EXTRACURRICULAR`) only when set.
- **`ProgramCategory` remains in PostgreSQL** for legacy rows and internal registry mapping but is no longer accepted on write paths or exposed on read DTOs.

PR1 replaced archive year navigation; this ADR covers PR2 (track type + category key removal from API contracts).

## Decision

1. Add nullable `Program.trackType ProgramTrackType?` with no backfill.
2. Create/update authoring requires `trackType`; reject leftover `category` in request bodies (pipe 400).
3. Server always sets `category=BASIC` and `applicationTemplateKey=basic` on create; ignore client category.
4. Remove `type` authoring step; collect track type in basic info step.
5. Resolve apply templates by `applicationTemplateKey` only — no category fallback on frontend or backend detail responses.
6. Replace `category` with `trackType|null` on all nine public/read surfaces listed in PR2; leftover `category` keys fail closed in frontend parsers.
7. Do **not** drop the `ProgramCategory` column.

## Consequences

- Legacy programs with `trackType=null` omit track metadata in list/detail UI until edited.
- Staff dashboard and landing parsers must accept `trackType` instead of `category`.
- Tests must cover key-only template resolve, leftover category rejection, and required trackType on create.

## Withdrawn

This ADR withdraws using #109's seven category values as the public display/input axis for new work. Internal `ProgramCategory` and `program-template.registry.ts` remain for legacy template registry and DB integrity until a later migration PR.
