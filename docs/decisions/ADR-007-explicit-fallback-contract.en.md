---
slug: ADR-007-explicit-fallback-contract
date: 2026-08-01
author: GoBeromsu
status: Accepted
references:
  - ADR-004-REST-API-규격
refines: []
---

# ADR-007: Explicit Fallback Contract

[한국어](ADR-007-explicit-fallback-contract.md) | **English**

English translation of the [Korean source](ADR-007-explicit-fallback-contract.md).
The Korean document remains authoritative.

## Status

Accepted

## Date

2026-08-01

## Context

The same type of defect was found in two different areas on the same day.
On the data side, an approach was proposed to infer and synthesize a target's GitHub login by querying the current User table at read time (read-time enrichment/backfill), because older rows (schemaVersion 1 / legacy) in an append-only audit ledger lacked a human-readable target name.
On the UI side, an approach avoided rendering the login button when backend availability was uncertain, hiding the user's affordance based on speculative runtime state.

Both approaches share the well-intentioned motivation of not showing failures or missing data directly to the user, but they cause the system to state something different from what it actually knows.
The audit ledger example overwrites historical facts that should be point-in-time snapshots with current state, distorting history after renames or deletion.
The hidden affordance example hides failure through silence (silent fallback) instead of exposing an explicit error when the action occurs (fail-fast), depriving users of the information needed to decide whether to retry.

ADR-004 (REST API Specification) fixes the shape of failure responses (RFC 7807 ProblemDetail + domain error code) as a contract, but it did not state the higher-level principles for when a substitute value may be shown or when and how failure must be exposed.
This decision generalizes ADR-004 to fill that gap and defines a common contract for both data read paths and UI rendering paths.

## Decision

> Every fallback must be an explicitly designed contract.
> Improvised read-time correction and concealed failure are fabrication, not fallback.

1. **A fallback is a contract** — declare it at design/write time and express it through types in code and rules in documentation.
   Do not invent it at read time.
2. **A fallback does not conceal itself** — its consumers (users or other developers) must be able to identify that the value they are viewing is a fallback.
   Do not disguise it as indistinguishable from original data.
3. **Improvised correction is not fallback** — reconstructing historical facts in the read layer using current state (read-time enrichment/backfill) or hiding affordances based on guessed state (capability hiding through speculative runtime state) is fabrication, not fallback as defined here.
   It is prohibited.

### Antipattern examples

- **Data:** Synthesizing a target's GitHub login for v1/legacy rows in an append-only audit ledger by querying the current User table at read time.
  A login rename or account deletion causes the displayed value to differ from the fact the historical row referred to, distorting history.
  - **Correct design:** Increase `schemaVersion` and record the target snapshot at write time (v2).
    For older rows without snapshots, do not synthesize values; expose the explicitly declared fallback of raw `targetType` / `targetId`.
- **UI:** Conditionally hiding the login button (affordance) when backend unavailability is suspected.
  It conceals failure by removing the action itself based on speculative runtime state, leaving users unable to determine why the button is absent.
  - **Correct design:** Render affordances deterministically.
    Expose actual failures when the action runs through RFC 7807 ProblemDetail and domain error codes (ADR-004).

### Examples of allowed fallbacks

Graceful degradation labeled so consumers can tell it is not original/current data, such as a cached display labeled “Data from 5 minutes ago,” is not prohibited — it is an explicit contract satisfying principles 1 and 2.

## Alternatives considered

### Allow read-time correction as a UX improvement

- Pros: Reduces apparently empty data on screens and immediately improves usability.
- Cons: Presents values different from the system's recorded facts as genuine.
  At boundaries where historical facts must remain immutable, such as append-only ledgers, this undermines audit trust itself.
- **Rejected:** If enrichment is needed, increase the schema version and record it at write time; expose historical rows with their declared fallback.

### Hide affordances for safety when state is uncertain

- Pros: Assumes users will not experience failure if actions that might fail are not shown.
- Cons: The state is only guessed, so false positives occur, and users cannot decide whether to retry because they cannot distinguish a missing feature from a temporary failure.
- **Rejected:** Render affordances deterministically and expose explicit errors when actions fail.

### Prohibit all fallbacks

- Pros: Eliminates the risk of fabrication at the source.
- Cons: Blocks legitimate graceful degradation, such as cached displays during offline operation or latency, harming UX.
- **Rejected:** Prohibit only improvised corrections that conceal themselves, not fallbacks themselves.
  Labeled graceful degradation is allowed.

## Consequences

### Enables

- Data paths such as ledgers and logs, where historical facts must remain immutable, do not distort history after renames or deletion.
- Consumers can always identify whether the displayed value is original data or a fallback.
- Failures surface as explicit errors at action time, letting users decide whether to retry.

### Costs / trade-offs

- Each new fallback requires explicit design at schema/type level instead of improvisation.
- Missing data or failed states must be shown as they are, so ad hoc UX patches intended merely to avoid empty screens cannot be used.

### New constraints

- Read/display layers do not reconstruct historical facts using current state.
  If a human-readable snapshot is needed, increase the schema version and record it at write time.
- Do not hide UI affordances based on guessed runtime state.
  Expose failures as ProblemDetail errors at action time.
- Do not introduce unlabeled graceful degradation (substitute values indistinguishable from original data) — identify degradation whenever it is displayed.

## Changelog

- 2026-08-01: initial decision

## References

- [RFC 7807: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc7807)
- [ADR-004: REST API Specification](ADR-004-REST-API-규격.en.md) — generalizes the failure response contract (RFC 7807 ProblemDetail)
