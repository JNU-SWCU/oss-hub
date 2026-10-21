---
slug: ADR-013-runtime-test-boundary
date: 2026-09-13
author: GoBeromsu
status: Accepted
references:
  - ADR-003-backend-architecture
  - ADR-005-agent-driven-review-cycle
---

# ADR-013: Frontend Runtime and Test Dependency Boundary

[한국어](ADR-013-runtime-test-boundary.md) | **English**

English translation of the [Korean source](ADR-013-runtime-test-boundary.md).
The Korean document remains authoritative.

## Status

Accepted

## Date

2026-09-13

## Context

If the frontend runtime depends on local-review API/persona routes, activation/session helpers, and a stateful support graph, product paths read test-only inputs.
This coupling makes evidence appear mixed with the real backend, and keeping it as a disabled emulator or compatibility flag blurs the boundary.
Verification must be proportional to the claim, and documentation/skill procedures must be routed to the work surface.

This decision defines the architectural boundary after migration risks have been addressed and behavior audited.
It does not claim that deletion has been completed or that test suites have passed.

## Decision

Remove local-review API/persona routes, activation/session helpers, and the stateful support graph from the Next.js runtime.
Do not relocate the emulator or preserve it behind a compatibility flag.
The path for previewing the product without a backend is intentionally removed.

Prove persistence, authentication, and authorization claims with an actual isolated backend.
Pure presentation, layout, and error surfaces may be proved with Vitest/components and narrowly scoped UI-only Playwright responses.
UI-only interception does not prove backend correctness.

Add project-path resolution to the existing ESLint rules to prevent frontend runtime dependencies on test modules.
Lint blocks literal and resolvable static, re-export, dynamic, require, and aliased dependencies.
This static boundary does not guarantee arbitrary computed imports, unknown module paths, or the semantic quality of poor test oracles.

Test inputs are minimal and narrowly scoped.
Documentation and skills open only the canonical router for the relevant surface rather than duplicating universal recipes.

## Drivers

Trustworthy evidence.
Enforceable architecture.
A maintenance scope that does not weaken safety or meaningful coverage.

## Alternatives considered

### A. Vitest/components + scoped UI-only Playwright responses + actual isolated backend

- Pros: Preserves low-cost layout/error proofs and independent persistence/authentication verification using existing tools.
- Cons: UI-only responses and real backend evidence must not be mixed into the same claim.
- **Accepted:** Reuses existing runners while removing runtime coupling.

### B. Use only a real backend for browser setup

- Pros: Presentation proofs also go through a real backend.
- Cons: Pure presentation proofs become expensive.
- **Rejected:** Retain a cheaper path for presentation-only claims.

### Other rejected paths

Keeping a disabled emulator, a renamed preview server, a copied E2E backend, lexical fixture bans, and a broad checker framework.

## Why chosen

A removes runtime coupling while using existing tools to separate low-cost UI proofs from real backend verification.

## Consequences

### Enables

- Everyday `pnpm dev` uses the actual backend.
- Automated browser regression uses the existing isolated Playwright runner.
- Package ESLint rejects resolvable runtime → test dependencies.

### Costs / trade-offs

- Old local-review URLs, cookies, and flags are intentionally removed.
- There is no backend-free product preview.

### New constraints

- Do not delete targets or tests before meaningful tests have been migrated.
- Unmigrated meaningful coverage gaps block cutover and must not be filled with unfinished stubs or compatibility paths.
- This ADR makes no bundle-size or performance claims.

## Changelog

- 2026-09-13: Recorded the runtime/test dependency boundary as Accepted.
- 2026-09-13: Explicitly documented real backend versus scoped UI proofs, lint limitations, prohibition on relocating the emulator or preserving flags, and the loss of backend-free previews.

## References

- [ADR-003](ADR-003-backend-architecture.en.md)
- [ADR-005](ADR-005-agent-driven-review-cycle.en.md)
