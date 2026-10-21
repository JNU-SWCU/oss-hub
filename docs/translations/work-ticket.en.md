# Work Ticket Template — English Reading Guide

[한국어](../../.github/ISSUE_TEMPLATE/work-ticket.md) | **English**

English translation of the [Korean source](../../.github/ISSUE_TEMPLATE/work-ticket.md).
The Korean document remains authoritative.
This reading guide is outside GitHub's automatic template directory, so it does not add or change an Issue template.
Use the original template when publishing; retain its Korean execution block and section names exactly.

Template metadata: name `작업 티켓` (Work ticket); description: work on one screen, publishable by any team member, with zero or one assignee; title `[P0] <화면 이름>` (screen name); labels `[ticket]`.

[issue-ticket-contract.md](../../skills/manage-qa-tickets/references/issue-ticket-contract.en.md) owns the body format.
AGENTS.md owns common rules; do not repeat them here.
The ticket contains only this screen's functional specification.
Follow [readability.md](../../skills/submit-pr-evidence/references/readability.en.md).

## 시작

*Start — preserve this exact block when publishing:*

```markdown
## 시작
담당자는 본인 에이전트에 한 줄: `oss-hub 티켓 #<번호> 진행해줘`
(에이전트가 gh로 이 본문을 가져와 AGENTS.md 규칙 아래 수행)
```

It tells the assignee to ask their agent to work on the numbered OSS Hub ticket; the agent retrieves the body through gh and follows AGENTS.md.

## 문제

*Problem*

- Area: `<frontend | backend | infra>` — Owner @handle.
- Frontend: `apps/frontend/src/app/.../page.tsx` (plus `src/features/<domain>/...` where needed), URL `/...`. For a screenless exception ticket, replace this line with the artifact location.
- Backend: `METHOD /api/v1/...` — `apps/backend/src/<module>/...`. List every endpoint this screen reads or creates; mark reused ones as existing.

Logic changes—branches, state transitions, authorization, asynchronous processing, call order, or layering boundaries—need a Mermaid/DOT diagram in the PR; `skills/submit-pr-evidence/references/backend-diagram.md` owns that requirement.

## 재현

*Reproduction*

Fill this only for defects: conditions → reproduction steps → actual versus expected result.
For a new feature, use `해당 없음` (not applicable) and define the work below instead.

## 작업 계약

*Work contract*

- Prerequisites: `<start after prerequisite Issue is Done, or none>`.

#### 할 일

*Required work*

Three required elements:

1. Permissions: which role can do what, and how other roles are blocked.
2. Input fields: for forms, list every field directly in the ticket, without substituting external-document references.
3. Screen states: how success, validation failure, error, and empty states appear.

- [ ] `<Mandatory implementation scope>`.

#### 하지 않을 것 (이 티켓의 경계)

*Do not do — this ticket's boundaries*

- `<Adjacent features: for example, editing/deletion belongs to another ticket and is not implemented here>`.
- `<File boundaries: for example, this ticket does not touch the schema because migration 1 already owns the tables>`.

#### 완료 조건

*Completion criteria*

- [ ] `<Role-specific scenario: for example, X succeeds for a STAFF account and is blocked for a STUDENT account>`.
- [ ] `<Data check: for example, the created item appears in the list/detail view>`.

## 우선순위와 기한

*Priority and deadline*

- `<Priority and rationale: for example, P1 / three business days for a reproducible functional defect that does not block release>`.
