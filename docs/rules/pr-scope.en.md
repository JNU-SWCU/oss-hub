# PR Scope and Decomposition Criteria

[한국어](pr-scope.md) | **English**

English translation of the [Korean source](pr-scope.md).
The Korean document remains authoritative.

This document defines how much change to include in one PR and when and how to split it.
It extends the commit-level rule in [AGENTS.md Code Conventions](../../AGENTS.en.md#code-conventions--common-patterns) (split a change when its summary needs “및·그리고,” meaning “and”) to the PR level.

## 1. Principle — One PR Equals One Logical Change

- Decision heuristics: ① Does the PR title need “및·그리고” (“and”)?
  ② Would reverting this PR remove exactly one semantic unit?
  ③ Can a reviewer read it completely in one session (about 60 minutes)?
- Do not mix refactoring with behavior changes in the same PR.
- Reference: [Google eng-practices — Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html)

## 2. Size — A Trigger to Consider Decomposition, Not a Gate

- When changes exceed 200–400 lines, consider decomposition first.
  Consider the number of files as well as the line count.
- Reference: [SmartBear — Best Practices for Peer Code Review](https://smartbear.com/learn/code-review/best-practices-for-peer-code-review/) (maintaining defect detection rates at 200–400 lines per session)

## 3. Decomposition Boundaries — Prefer Vertical Slices

- The default is a vertical slice by feature.
  Splitting by layer (FE/BE) is not a goal in itself.
- Parallelize by dividing work into independent, small PRs: merge a small contract (specification/types) PR first, then open FE and BE PRs that are independent of each other and can merge in either order.
  For API contract changes, first check consistency with [ADR-004](../decisions/ADR-004-REST-API-규격.en.md).
- Merge code shared by multiple features (utilities, types, configuration) independently before the feature PRs — the same principle as the shared-path rule in [AGENTS.md Code Conventions](../../AGENTS.en.md#code-conventions--common-patterns).
- References: [API contract-first](https://apisyouwonthate.com/blog/a-developers-guide-to-api-design-first/) · [vertical slice architecture](https://deviq.com/architecture/vertical-slice-architecture/) · [Independent in INVEST](<https://en.wikipedia.org/wiki/INVEST_(mnemonic)>)

## 4. Stacked PRs — Serialize by Default; Keep Exceptions Shallow

- Even when a later PR has a sequential dependency and makes no sense without an earlier one, the default is serialization, not stacking: merge the earlier PR, then open the next PR from main.
- Reason: under the head SHA revalidation rule in [ADR-005](../decisions/ADR-005-agent-driven-review-cycle.en.md), each rebase invalidates the reviews and verification of downstream PRs.
  The author does not control merge timing because it is an approval gate, so “the base will merge quickly” cannot be a prerequisite.
- Use a stack only for exceptions where preparing the changes in advance is worth the potential delay in merging the base.
  Even then, each layer must meet the size criteria in §2 and the stack must remain shallow.
- [AGENTS.md Code Conventions](../../AGENTS.en.md#code-conventions--common-patterns) is authoritative for when a downstream PR may be Draft and when Draft status must be removed — this document does not duplicate that rule.
- Graphite is included only as a general reference for stack management: [Graphite — Stacked PRs](https://graphite.com/blog/stacked-prs)

## 5. Minimize the Conflict Surface

- Reducing the number of files a PR touches is the most direct way to support parallel merging.
- When file overlap is expected, coordinate the scope.
  For shared paths, claim ownership through an Issue under [AGENTS.md Code Conventions](../../AGENTS.en.md#code-conventions--common-patterns), then change them in an independent, small PR.
- Keep branch lifetimes short.
- Reference: [trunk-based development — short-lived feature branches](https://trunkbaseddevelopment.com/short-lived-feature-branches/)

---

This document extends [AGENTS.md Code Conventions](../../AGENTS.en.md#code-conventions--common-patterns) (Draft PRs, shared paths, and commit rules) and follows [ADR-004](../decisions/ADR-004-REST-API-규격.en.md) (the authoritative API contract) and [ADR-005](../decisions/ADR-005-agent-driven-review-cycle.en.md) (head revalidation and merge gates).
The DB migration serialization rule in [AGENTS.md Code Conventions](../../AGENTS.en.md#code-conventions--common-patterns) takes precedence over this document.
