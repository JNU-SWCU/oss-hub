---
slug: ADR-004-REST-API-규격
date: 2026-07-11
author: GoBeromsu
status: Accepted
references:
  - ADR-003-backend-architecture
refines: []
---

# ADR-004: REST API Specification

[한국어](ADR-004-REST-API-규격.md) | **English**

English translation of the [Korean source](ADR-004-REST-API-규격.md).
The Korean document remains authoritative.

## Status

Accepted

## Date

2026-07-11

## Context

Because the frontend and backend can change independently, URLs, success and failure responses, naming, and validation rules must be fixed in a single contract.
HTTP already provides standard semantics through status codes and headers, so response bodies should directly express the data and error information consumers need.
List APIs must provide predictable query costs and UI behavior as data grows.

## Decision

Place all REST APIs under `/api/v1` and use plural nouns, kebab-case, and hierarchical URLs.
Set the NestJS global prefix to `api/v1` as well.
Successful responses return plain DTOs without a separate envelope.
Failure responses use RFC 7807 ProblemDetail with an additional domain error `code`.
Codes follow the `USR_001` format: a three-letter English domain abbreviation and three digits, with each domain owning its ErrorCode enum.

Use camelCase for JSON fields.
Boolean fields use `is`, `has`, or `can` prefixes, and enum values use UPPER_SNAKE_CASE.
All list queries provide pagination.
Validate inputs at the controller DTO boundary and do not expose internal domain models directly as API contracts.
Transport-layer errors before routing (such as 431 header overflow or malformed HTTP requests) are handled by the Node HTTP parser and are excluded from the ProblemDetail contract.

| HTTP method | Purpose | Example |
| --- | --- | --- |
| GET | Retrieve a single item or list | `GET /api/v1/users`, `GET /api/v1/users/{userId}` |
| POST | Create a resource or perform an explicit action | `POST /api/v1/users` |
| PUT | Replace a resource completely | `PUT /api/v1/users/{userId}` |
| PATCH | Update part of a resource | `PATCH /api/v1/users/{userId}` |
| DELETE | Delete a resource | `DELETE /api/v1/users/{userId}` |

Example failure response:

```json
{
  "type": "https://api.oss-hub.example/problems/user-not-found",
  "title": "User not found",
  "status": 404,
  "detail": "요청한 사용자를 찾을 수 없습니다.",
  "instance": "/api/v1/users/42",
  "code": "USR_001"
}
```

### Resource naming and compatibility principles

URIs express product resource nouns, not backend implementation details.
If the canonical collection exposed to anonymous visitors is a projection-only resource without a corresponding private collection at the same level, do not add a `public` prefix or suffix — for example, `GET /projects`.
This rule does not reject other cases where a distinct visibility projection, directory, or trust boundary makes `public` meaningful (such as the separate public directory approach used by some APIs); it applies only to resources touched in this repository.
Represent resource subsets (category, status, search terms, and so on) with query parameters, not separate endpoints or path segments.
`/me` is a repository-local convention, not a REST standard, and is used only for caller-owned resources (`GET /users/me/profile`) — record that APIs use different spellings for the same concept (GitHub `/user`, Zalando `self`) as part of the rationale, rather than claiming a universal standard.
Domain commands that do not fit naturally into CRUD may exceptionally use verb-based action resources (`POST /repositories/{repositoryId}/publish`).
Limit this exception to cases such as explicit state transitions where a standard resource representation would be awkward; ordinary creation, retrieval, modification, and deletion use standard CRUD resources.

Renaming or removing an existing route is a breaking change by default.
While this repository owns both frontend and backend in one repo and is in a pre-release phase (no production traffic or confirmed external consumer contracts), an alias-free clean break is allowed only for touched paths where an actual investigation confirms there are no external consumers.
This exception is tied to the conditions that the same repo controls both sides and an investigation confirms there is no external contract; it does not apply to general API renames when those conditions do not hold.
If actual external callers (other repositories or third-party clients) are confirmed or declared, do not make a clean break: retain the existing route as an alias with a deprecation notice, or separate it into a differently versioned contract (`/api/v2`).

This is a boy-scout rule applying only to routes actually being changed.
Existing routes untouched by this decision remain valid contracts; retrospective renaming is not required.

## Alternatives considered

### Response envelope

- Pros: Can provide success indicators and metadata in the same shape for every response.
- Cons: Duplicates HTTP status and error semantics in the body and complicates consumption of plain DTOs.
- **Rejected:** Avoid duplicating HTTP standards; express successful data as plain DTOs and failures clearly through RFC 7807.

### Arbitrary string error codes

- Pros: Quick to add error messages in initial implementation.
- Cons: Makes domain ownership, searchability, and client branching rules unclear.
- **Rejected:** Domain-specific ErrorCode enums and fixed-format codes provide a stable client contract.

### Adopt `/me` as a universal REST standard

- Pros: A short, familiar spelling for the caller's own resources.
- Cons: APIs use different spellings, such as GitHub `/user` and Zalando `self`, so claiming a universal standard would be inaccurate.
- **Rejected:** State it as a repository-local convention limited to caller-owned resources.

### Increment the version prefix for every route rename

- Pros: API versions are always explicit, and compatibility decisions do not require human investigation.
- Cons: Creating `/api/v2` for every rename during pre-release when there are no confirmed external consumers costs more to maintain than it benefits.
- **Rejected:** Allow clean breaks for touched paths where investigation confirms no external consumers, and introduce version separation or aliases when external consumers are confirmed.

## Consequences

### Enables

- The frontend can handle HTTP status and DTO/ProblemDetail shapes predictably.
- Connect API documentation, logs, and client error handling through domain codes.
- List APIs provide pagination as a default contract.

### Costs / trade-offs

- Each new endpoint needs DTO validation, error codes, and pagination contracts designed.
- Even simple endpoints cannot rely on shared metadata through an envelope.

### New constraints

- URLs use plural kebab-case resource paths under `/api/v1`.
- Do not add an envelope wrapping success status to successful responses.
- Failure responses include RFC 7807 ProblemDetail and a `code` in `AAA_000` format.
- JSON uses camelCase; booleans use `is`, `has`, or `can`; enum values use UPPER_SNAKE_CASE.
- List endpoints provide pagination and validate inputs at the DTO boundary.
- URIs express product resource nouns and do not expose implementation details.
- Canonical anonymous collections without a private counterpart do not receive a `public` prefix or suffix (for example, `/projects`) — this rule is limited to resources touched in this repository.
- Represent resource subsets through query parameters, not separate path segments.
- `/me` is a repository-local convention used only for caller-owned resources — do not claim it is a universal REST standard.
- Exceptionally allow verb-based action resources only for domain commands not expressed through standard CRUD.
- Route renames and removals are breaking changes by default.
  A clean break for a touched path is allowed only under the pre-release conditions that the same repo owns both frontend and backend and investigation confirms there are no external consumers.
- If external callers are confirmed or declared, retain an alias plus a deprecation notice or separate the contract by version instead of making a clean break.
- These principles apply only to touched paths; existing routes untouched by this decision are grandfathered and remain valid.

## Changelog

- 2026-07-11: initial decision
- 2026-07-11: Added the transport-layer error exclusion.
- 2026-07-31: Added product resource naming, query filters, repo-local `/me`, exceptional command resources, the breaking-change default for route renames and conditions for touched pre-release clean breaks, and alias/deprecation rules when external consumers are confirmed.

## References

- [RFC 7807: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc7807)
- [Pullit API Design Guidelines (Korean)](https://pullit-docs-server.vercel.app/index.html#02-api-design)
- [addyosmani/agent-skills — api-and-interface-design](https://github.com/addyosmani/agent-skills/tree/main/skills/api-and-interface-design)
