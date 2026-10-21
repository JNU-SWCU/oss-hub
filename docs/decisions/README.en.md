# Architecture Decision Records

[한국어](README.md) | **English**

English translation of the [Korean source](README.md).
The Korean document remains authoritative.

This directory records technical and operational decisions that are costly to change as ADRs (Architecture Decision Records).
ADRs are permanent topic anchors and are not deleted; when a decision changes, update the same document to reflect the current decision and record the change in its Changelog.

## ADR index

| Number  | Status   | Decision                                                                            | Document                                                                                   |
| ------- | -------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| ADR-001 | Accepted | Technology stack                                                                    | [ADR-001-테크스택 (Korean)](ADR-001-테크스택.md)                                           |
| ADR-002 | Accepted | CI/CD pipeline                                                                      | [ADR-002-CI-CD-파이프라인 (Korean)](ADR-002-CI-CD-파이프라인.md)                           |
| ADR-003 | Accepted | Backend layering, injection tokens, and authentication/authorization boundaries     | [ADR-003-backend-architecture (Korean)](ADR-003-backend-architecture.md)                   |
| ADR-004 | Accepted | REST API specification                                                              | [ADR-004-REST-API-규격 (Korean)](ADR-004-REST-API-규격.md)                                 |
| ADR-005 | Accepted | Agent-Driven Review Cycle                                                           | [ADR-005-agent-driven-review-cycle (Korean)](ADR-005-agent-driven-review-cycle.md)         |
| ADR-006 | Accepted | GitHub App integration for organization automation                                  | [ADR-006-github-app-integration (Korean)](ADR-006-github-app-integration.md)               |
| ADR-007 | Accepted | Explicit fallback contract                                                          | [ADR-007-explicit-fallback-contract (Korean)](ADR-007-explicit-fallback-contract.md)       |
| ADR-008 | Accepted | API response field ownership boundaries                                             | [ADR-008-api-response-field-ownership (Korean)](ADR-008-api-response-field-ownership.md)   |
| ADR-009 | Accepted | Permission and collection boundaries for student-owned repository connections (OWN) | [ADR-009-own-repository-connection (Korean)](ADR-009-own-repository-connection.md)         |
| ADR-010 | Accepted | Contribution tracking context — the §7 Port policy is superseded by ADR-003         | [ADR-010-contribution-tracking-context (Korean)](ADR-010-contribution-tracking-context.md) |
| ADR-011 | Accepted | Type boundaries for query filters — do not pass sentinel strings as SQL values      | [ADR-011-query-filter-type-boundary (Korean)](ADR-011-query-filter-type-boundary.md)       |
| ADR-012 | Accepted | ProgramTrackType replaces category in the public API and authoring input            | [012-program-track-type](012-program-track-type.md)                                        |
| ADR-013 | Accepted | Frontend runtime and test dependency boundaries                                     | [ADR-013-runtime-test-boundary (Korean)](ADR-013-runtime-test-boundary.md)                 |

## ADR lifecycle

`Accepted` means the decision has been approved; it does not mean that implementation across the codebase or verification is complete.
Refer to the linked GitHub Issues and PRs for implementation status and execution evidence.

1. The proposer records a cross-cutting decision that is difficult to reverse as an ADR with the status `Proposed`.
2. Change an agreed decision to `Accepted`, and complete its rationale, alternatives, and consequences to reflect the current facts.
3. Mark decisions that no longer apply as `Deprecated`, and link the replacement decision and its impact in References.
4. When a decision changes, update the same ADR rather than creating or deleting a file, and record the date and reason in its Changelog.

Detailed implementation procedures and short-lived configuration values do not belong in ADRs.
Record them in an execution plan or operations document.
