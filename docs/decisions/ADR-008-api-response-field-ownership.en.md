---
slug: ADR-008-api-response-field-ownership
date: 2026-08-01
author: GoBeromsu
status: Accepted
references:
  - ADR-004-REST-API-규격
  - ADR-007-explicit-fallback-contract
refines: []
---

# ADR-008: API Response Field Ownership (Backend Judgment vs Frontend Static Copy)

[한국어](ADR-008-api-response-field-ownership.md) | **English**

English translation of the [Korean source](ADR-008-api-response-field-ownership.md).
The Korean document remains authoritative.

## Status

Accepted

## Date

2026-08-01

## Context

A compile-time constant Korean sentence was included as a backend response DTO field in the ranking API.
`RANKING_NOTICE`, a notice always identical regardless of input or state, was defined in `apps/backend/src/ranking/domain/ranking.ts` and included in the `notice` field of `RankingPageResponseDto` (`apps/backend/src/ranking/dto/ranking-response.dto.ts`).
The frontend `parseRankingPage` (`parseRankingPage` in `apps/frontend/src/features/ranking/api.ts`) even included it in the required keys for `hasExactKeys` parsing validation.

The backend made no judgment about this string — it simply sent the same sentence regardless of input or state.
Yet making it part of the API response contract created unnecessary coupling: changing the copy required changing both the backend and frontend parser.
This work resolved the issue by removing `notice` from both contracts — the current `RankingPageResponseDto` has no `notice` field (only `period`, `items`, `page`, `pageSize`, and `total`), the `hasExactKeys` list in `parseRankingPage` is narrowed to the same five keys, and `apps/frontend/src/features/ranking/api.test.ts` explicitly adds a test rejecting responses containing `notice` as an out-of-contract field.

This decision records the principle for preventing recurrence as an ADR.
ADR-004 (REST API Specification) fixes response shape (camelCase, plain DTOs without envelopes, and ProblemDetail), but not which values belong in response fields.
ADR-007 (Explicit Fallback Contract) covers fallback/degradation presentation, but not static copy that requires no judgment entering a contract in the first place.
This decision fills that gap.

## Decision

> The frontend owns static content; the backend makes state-dependent judgments.
> Backend responses carry only judgments and state values that only the backend can know.
> Static display copy that is always identical regardless of input or state is not a backend judgment and does not belong in the response contract.
> Do not send values the backend has no reason to send.

Use this single question to classify ownership.

> **Does this value vary with input or state?** If not, it must be a frontend constant.

| Category | Criterion | Examples |
| --- | --- | --- |
| Backend-owned (must be included in the response) | A judgment result that varies with input or state | Enums, booleans, reason codes, numbers, dates, authorization/visibility decisions |
| Frontend-owned (must not be included in the response) | Display copy, labels, or notice sentences that are always identical — not calculated by the backend | Compile-time constant notice text, fixed label text |

Apply this question before designing a new response field.
If the answer is no, keep the value as a frontend constant and do not add it to the API contract.

## Known unresolved deviations

This principle is not being applied retrospectively to the entire repository today.
Investigation found no additional backend occurrences of the ranking pattern (static copy sent as a response field without judgment).
However, two adjacent cases required consideration and are recorded below.

### 1. `ProblemDetail.detail` — intentional exception

Domain-specific `*-error-code.enum.ts` files, including `apps/backend/src/programs/program-error-code.enum.ts`, declare fixed Korean messages for each error code (such as `ProgramErrorCode`) in maps such as `PROGRAM_ERROR_CODES`.
`ProblemDetailFilter.toProblemDetail` in `apps/backend/src/common/problem-detail.filter.ts` (called by `ProblemDetailFilter.catch`) includes the message directly as `detail: exception.errorCode.message`.
The frontend renders `error.problem.detail` directly throughout the application, including through `adminAccessMutationErrorMessage` in `apps/frontend/src/features/roles/admin-access-mutation-policy.ts`.

This differs from the ranking case.
Although each individual message is fixed, **which error code occurs** is itself a judgment that varies with request and state.
It is a finite set selected by code, not a purely static constant.
It also follows the RFC 7807 convention for `detail` as a human-readable explanation.
Unlike ranking's `notice`, unconditionally attached to every response, this value depends on the error code, so it is not classified as a violation of this decision.
Because changing it has global impact (all domain error messages and frontend-wide rendering paths), retain the current behavior and record it here only as an intentional exception.

### 2. D-day label logic duplication — unresolved deviation, direction undecided

The `milestoneDeadline` function in `apps/frontend/src/features/submissions/submission-checklist.ts` independently reimplements the D-day label rules defined by `programDeadline` in `apps/backend/src/programs/program-deadline.ts` (Asia/Seoul calendar-day differences and the labels `마감 지남` / `오늘 마감` / `D-n`).
The duplication arose because the checklist API provides only `dueAt`, not a label.

This case runs in the opposite direction to the principle above — the backend already has the same judgment logic (`programDeadline`), but does not include its result in the response, so the frontend recreates it.
D-day status and labels depend on `dueAt` and the current time, making them closer to backend-owned under the criterion above.
However, only the risk of changing one implementation but not the other when timezone rules change has been established; no resolution direction is selected.
Possible resolutions are (a) adding the label/D-day to the checklist API response to centralize judgment in the backend, or (b) generating labels through a shared frontend utility across all three paths (checklist, program detail, and milestone rows).
This decision selects neither.

Neither case is declared a principle violation — case 1 is an intentional exception; case 2 is recorded as an unresolved deviation whose resolution requires a separate decision.

## Alternatives considered

### Include display copy in backend responses to reduce frontend hardcoding

- Pros: Copy can be managed in one place (the backend), and the frontend can render the response directly.
- Cons: When a value is static copy rather than a judgment, the API contract couples even a wording change to updates in both backend and frontend parsers.
  As with ranking's `notice`, one static sentence can break the frontend's exact-key parsing validation.
- **Rejected:** Keep static copy as frontend constants and include only values requiring judgment in the API contract.

### Move every display string to the frontend without exceptions, including error messages

- Pros: Completely narrows backend response contracts to pure data.
- Cons: Forcing values such as `ProblemDetail.detail`, whose selected error code is itself a judgment based on request/state, into frontend constants means artificially imitating finite but state-dependent information as a static string set.
  The impact is also global.
- **Rejected:** The criterion is not whether an individual value is fixed, but whether the value selected depends on state.
  If selection from a finite set depends on state, as with error-code messages, backend ownership remains.

## Consequences

### Enables

- Determine backend/frontend ownership for new response fields with a single question: “Does it vary with input or state?”
- Change static display copy without requiring both backend deployment and frontend parser updates.
- Narrow the backend response contract to values that actually require judgment, making its meaning clearer.

### Costs / trade-offs

- Instead of habitually sending values from the backend, adding each new field requires first examining whether it is really a judgment.
- Existing cases that do not fit the principle exactly, such as `ProblemDetail.detail` and duplicated D-day labels, require an explicit choice to retain them as known deviations rather than immediately removing them — there is a cost to deferring judgment.

### New constraints

- Do not add a new API response field if “Does it vary with input or state?” is answered no.
  Keep such values as frontend constants.
- Values selected from a finite set based on state, such as error-code messages, may remain backend-owned as an exception — but there must be evidence that the selected code depends on state.
- Do not introduce new independent frontend and backend implementations of the same judgment logic.
  This ADR does not decide how to resolve the existing D-day label duplication, so retain current behavior until a separate decision.

## Changelog

- 2026-08-01: initial decision — established backend/frontend response field ownership following removal of the ranking API's `notice` field.
  Recorded `ProblemDetail.detail` as an intentional exception and duplicated D-day labels as an unresolved deviation.

## References

- [ADR-004: REST API Specification](ADR-004-REST-API-규격.en.md) — response shape and error-code contract
- [ADR-007: Explicit Fallback Contract](ADR-007-explicit-fallback-contract.en.md) — fallback/degradation presentation contract
