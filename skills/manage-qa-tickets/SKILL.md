---
name: "manage-qa-tickets"
description: "Create, deduplicate, migrate, verify, or publish executable OSS Hub QA tickets from the Notion QA request database. Use for QA ticket intake, assigning a single owner, calculating a 1/3/5-business-day deadline, rewriting a safe GitHub work ticket, or restructuring legacy QA rows. Not for running release QA or fixing product code."
---

# Manage QA tickets

Keep the Notion `🐞 QA 요청` database as the QA record of truth and use a GitHub Issue only as the public execution surface.
Make every ticket executable without hidden context while keeping private source material out of the public repository.

## Guardrails

1. Read the repository [AGENTS.md](../../AGENTS.md) and [security rules](../../docs/rules/security.md) before any write.
2. Use `run-release-qa` instead when the user asks to exercise a release candidate or discover defects.
3. Do not modify product code, deployment state, accounts, or test data while managing tickets.
4. A UI ticket covers one screen and one logical change, while a screenless ticket covers one output location and one logical change.
5. Never attach real data, personal information, credentials, private repository details, or an unredacted screenshot.
6. Assign at most one person in `담당자`.
7. Keep `완료 여부` manual and unchecked until a person verifies every completion condition in the deployed environment.
8. Do not infer an unrecorded role, reproduction step, expected result, dependency, or implementation boundary.
9. Write `미기록` in the Notion body when required legacy information is absent.
10. Do not create or update a Notion row unless the user asked for that write.
11. Do not create or update a GitHub Issue unless the user explicitly asked for the public handoff.

## 1. Read the current database

Read the current schema, default template, visible rows, and maximum `QA<number>` before drafting.
Use the property and body contract in [notion-ticket-contract.md](references/notion-ticket-contract.md).
Treat live schema and accepted Notion state as evidence.
If the live schema or default template differs from the bundled contract, stop and ask before writing instead of silently inventing replacement fields.

## 2. Deduplicate before drafting

Requery Notion immediately before creating a row.
Do not create a row when any one of these conditions matches an existing row:

- A core title phrase is equal or one title contains the other.
- The route path, persona, and symptom summary are the same.
- The core problem sentence describes the same failure, route, and role.
- The evidence names the same baseline SHA or QA round.

Update or reference the existing row instead.
A different suspected root cause is not enough to create a second row when the user-visible symptom and reproduction are the same.

## 3. Normalize the ticket facts

Draft a symptom-led title in the form `QA<number>. <관찰된 증상>`.
Use the next number after the current maximum and do not reuse a deleted number.
Choose exactly one work type:

- `fix`: observed behavior contradicts the expected behavior.
- `feat`: the requested user capability does not exist yet.
- `refactor`: internal structure changes without user-visible behavior change.
- `chore`: tooling, operations, documentation, or maintenance work.

Choose one or more personas only from `교직원`, `학생`, and `관리자`.
Leave the property empty and write `미기록` in the body when the persona is not supported by evidence.
Preserve an entire reproduction URL when it is safe to store in Notion.
Use `해당 없음` only when the work genuinely has no route and use `미기록` when the route is unknown.
Label evidence as an executed observation, automated test, code inspection, or unverified report.
Use `확인 필요` in the narrative when the behavior was not reproduced end to end.

## 4. Calculate the deadline

Calculate `마감` from the Notion creation date.
The day after publication is the first possible business day.
Count Monday through Friday and use an authoritative holiday calendar only when one is available.
Otherwise count weekdays only and state that assumption in the completion report.

Choose the shortest tier supported by the observed impact:

- 1 business day: security or privacy exposure, data loss or corruption, authorization bypass, or a release-blocking core flow.
- 3 business days: a reproducible functional, API, or infrastructure defect that is not in the 1-day tier.
- 5 business days: non-blocking UX, design, accessibility, refactor, chore, or enhancement work.

If the impact does not support a tier, ask instead of guessing.
For an explicitly approved legacy backfill, map recorded security or personal-data categories to 1 day, functional or infrastructure categories to 3 days, and UX or design-only categories to 5 days.
Use the approved default of 3 days for legacy rows whose category is blank and record that assumption in the migration report.

## 5. Draft the body

Use the body template from [notion-ticket-contract.md](references/notion-ticket-contract.md).
Keep the problem and impact to two to four sentences.
Write steps as directly observed actions and do not reconstruct steps from a suspected implementation.
Make completion conditions observable from the named persona.
Name the narrowest explicit non-goal under `절대 금지`.
Keep the Notion properties as index and assignment metadata and the page body as the execution contract.

## 6. Review before writing

Check that the title, work type, personas, deadline tier, reproduction, actual result, expected result, minimum requirement, completion conditions, and forbidden scope agree.
Show the draft first when the requested write surface, assignee, deadline tier, or public-safe boundary is ambiguous.
A request to draft is not permission to publish.

## 7. Write and verify Notion

Create the row from the default `QA 티켓` template.
Set `상태` to `신규`, leave `완료 여부` unchecked, retain the automatic requester and request date, and assign zero or one owner.
Fill only supported property values and put narrative detail in the page body.
Refetch the saved page after writing.
Verify the exact title, work type, personas, due date, assignee count, unchecked completion flag, URL, evidence references, and every required body section.
Treat the write as incomplete until the refetched record matches the draft.

## 8. Publish a GitHub execution ticket

Use the repository [work-ticket template](../../.github/ISSUE_TEMPLATE/work-ticket.md) and the downstream [tickets skill](../../.claude/skills/tickets/SKILL.md).
Only `@GoBeromsu` and `@Lumiere001` may publish and assign a work ticket.
If the authorized actor cannot be verified, produce a draft and stop before publication.
Rewrite the contract for the public Issue instead of quoting the Notion body.
Use GitHub handles only and replace private URLs, data, screenshots, and identifiers with safe route patterns or synthetic examples.
Fill every work-ticket section, including the area, frontend or output location, backend or API, dependencies, minimum requirements, completion conditions, and forbidden scope.
For screenless work, replace the frontend section with the template's `산출물 위치` form.
Fill the Issue so it is executable without opening Notion.
The three downstream execution-contract sections must be complete:

1. `최소 요구 (기능)` contains the smallest implementation scope, role rules, inputs, and visible states.
2. `완료 조건 (기능 검증)` contains observable, checkable outcomes.
3. `절대 금지 (이 티켓의 경계)` contains adjacent work and file or schema boundaries.

Write the draft title and body to a temporary file outside the repository and scan that exact text before publication:

```bash
ISSUE_TEXT="$(cat <draft-file>)" bash scripts/check-public-safe.sh --text-only
```

After creation, refetch and verify the Issue title, body, labels, authorized assignee, and reference to the Notion QA number without copying private content.

## 9. Migrate legacy rows safely

Confirm that the source database is governed by the no-real-data rule before reading or migrating narrative fields.
Back up only the normalized, public-safe source fields to an approved temporary location outside the repository.
Do not export attachments, credentials, personal information, private repository details, or an unrestricted raw database dump.
If a row contains a forbidden value, exclude that row, stop its migration, and request a secure remediation path instead of copying or silently redacting it.
Count numbered rows, duplicates, gaps, non-numbered rows, missing source text, and already migrated markers.
Do not alter a titleless or non-numbered row without separate approval.
Skip an already migrated row rather than appending a second execution body.
Append the new execution body without deleting an existing page body.
For a source row verified as safe, copy the legacy problem text exactly into `문제와 영향` and preserve old classifications as labeled legacy facts.
Use `미기록` for fields that have no source evidence.
Backfill supported personas and deadlines only with the declared mapping.
Refetch every target row and prove that each safe source problem text appears exactly once in the body and that each calculated deadline matches.
Require explicit approval for deleting a legacy source property after the verification report is complete.
If any row fails validation, retain every source property and report the failed row and recovery path.
Report the final row count, exceptions, tier counts, persona counts, and deleted properties.

## Completion checklist

- [ ] The live Notion schema and default template were read.
- [ ] Duplicate QA rows were checked before creation.
- [ ] One screen or one output location and one logical change are covered.
- [ ] Work type, personas, one-or-zero assignee, and due date are evidence-backed.
- [ ] Missing legacy information is `미기록`, not inferred.
- [ ] The saved Notion page was refetched and matched.
- [ ] Any GitHub Issue fills every repository template section, is independently executable, and passed the exact-text `ISSUE_TEXT` public-safe scan.
- [ ] Any legacy property deletion followed a complete source-to-body verification and explicit approval.
