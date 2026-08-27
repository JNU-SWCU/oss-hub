---
name: "manage-qa-tickets"
description: "Creates, deduplicates, rewrites, migrates, verifies, or publishes executable OSS Hub QA tickets from the Notion QA request database. Use for QA ticket intake, declaring whether a ticket is frontend, backend, or infra work, capturing a frontend screen by DOM selector instead of a whole-page shot, pairing every reference UI with its own capture, opening a ticket with a short warm note to whoever picks it up, turning a UX improvement into a human-readable ticket, matching a user-edited reference ticket, assigning one owner, calculating a 1/3/5-business-day deadline, rewriting a public-safe GitHub work ticket, or restructuring legacy QA rows. Not for running release QA, designing the screen itself, or fixing product code."
metadata:
  version: "1.4.0"
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
6. Keep a third-party product capture inside Notion and let the public repository carry its URL only.
7. Assign at most one person in `담당자`.
8. Keep `완료 여부` manual and unchecked until a person verifies every completion condition in the deployed environment.
9. Do not infer an unrecorded role, reproduction step, expected result, dependency, or implementation boundary.
10. Write `미기록` in the Notion body when required legacy information is absent.
11. Do not create or update a Notion row unless the user asked for that write.
12. Do not create or update a GitHub Issue unless the user explicitly asked for the public handoff.

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

Declare exactly one area from `frontend`, `backend`, and `infra` as the first line of the body.
The area decides which evidence the ticket must carry, and the per-area minimum lives in [notion-ticket-contract.md](references/notion-ticket-contract.md).
When one request spans two areas, split it into two tickets instead of widening the evidence contract.

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

## 4.5 Collect evidence in parallel lanes

Capture, code anchors, and deduplication feed the body but never feed each other, so run them as concurrent read-only subagent lanes instead of in sequence.
Run exactly one browser lane — a second one fights it for the same tab.
Hand each lane a settled target rather than a judgment call, take its report as a claim, and keep only what arrives with a checkable path, `file:line`, or row id.
The lane split, the capture procedure, the [`qa-dom-capture`](agents/qa-dom-capture.md) and [`qa-code-anchor`](agents/qa-code-anchor.md) agents, and what to do with a lane's report live in [evidence-pipeline.md](references/evidence-pipeline.md).

## 5. Draft the body for the ticket type

Use the applicable body variant from [notion-ticket-contract.md](references/notion-ticket-contract.md).
Keep the Notion properties as index and assignment metadata and the page body as the execution contract.
When the user names a manually edited reference ticket, reopen it before drafting and match its section order, sentence density, and vocabulary without copying topic-specific content.

Open every body with a two-to-three-line note to the person who will pick the ticket up, placed above the first heading.
Name the friction they already feel on this screen, say what this ticket changes for them, and point at where the evidence sits.
Keep it warm and specific to this screen — a greeting that would fit any ticket is filler, and so is praise the reader has not earned yet.

### Functional defect or regression

Use the reproduction-centered body when an observed result contradicts an expected result.
Keep the problem and impact to two to four sentences.
Write steps as directly observed actions and do not reconstruct steps from a suspected implementation.
Use `확인 필요` instead of invented reproduction details when execution evidence is incomplete.

### UX or design improvement

Use the human-readable UX body when the request improves an existing flow rather than reports a failing function.
Explain the current experience, user cost, and intended outcome before implementation details.
Then describe the UX direction, expected user flow, reference UI, minimum requirements, completion conditions, work scope, and current-screen evidence in that order.
Write one idea per bullet in natural Korean and keep technical starting files and forbidden boundaries under `작업 범위`.
For each reference UI, pair the full URL with a capture of the element that shows the pattern, and state both what is useful and how OSS Hub should apply it.
A reference that has only a link is not admissible — capture it or drop it.
Reuse the standing product references in [ux-reference-catalog.md](references/ux-reference-catalog.md) before searching for a new one, and point at that catalog instead of restating its URLs and boundaries in the ticket.
Before locking the reference UI, name the problem at the user-flow level rather than the component level and inspect a small bounded set, typically two to four candidates, with a real screen or image of the relevant interaction.
Prefer a familiar standard pattern over a niche or feature-heavy product when the underlying flow is ordinary CRUD, file handling, or date selection.
When the system can derive order or the flow has one primary action, remove manual reordering and keep nonessential actions out of the main surface.
For each candidate, record the aspect to borrow, what not to copy, and its OSS Hub boundary.
Treat approval as aspect-scoped because the user may combine one reference's interaction with another's information structure.
When the user rejects a candidate, remove it instead of carrying it into the ticket and search again at the requested simpler or more familiar level.
When the request includes reference comparison or selection, reuse any explicit approval already present in the request; otherwise show the proposed `<sub-flow> = <reference pattern>` recipe and obtain approval before writing.
After approval, freeze that recipe, stop expanding the search unless asked, and include only its patterns in `UX 방향` and `참고 UI`.
Do not invent a `재현` section for a prospective improvement, but retain concise reproduction conditions when the problem was directly observed and those conditions matter.

For a `frontend` ticket, settle the CSS selector before capturing anything.
Point at the element in the live page, read its selector and DOM path, capture that element's area alone, and record the selector, DOM path, full URL, and observation time beside the image.
A whole-page screenshot with a caption explaining where to look does not satisfy this contract.
When the selector cannot be settled, hold the capture and mark it `확인 필요` rather than writing `미기록`.
The same rule governs both the current-screen capture and every reference capture.

For both variants, make completion conditions observable from the named persona and state the narrowest explicit non-goal.

## 6. Review before writing

Hand the finished draft to [`qa-fact-checker`](agents/qa-fact-checker.md) before writing to Notion, and never let the lane that drafted a claim be the one that clears it.
Fix every `REFUTED` claim before publishing and carry every `UNVERIFIED` one into the body as `확인 필요`.

Check that the title, work type, personas, deadline tier, applicable body facts, minimum requirements, completion conditions, and forbidden scope agree.
For a functional defect, verify the reproduction, actual result, and expected result.
For a UX improvement, verify the current problem, intended outcome, expected flow, and bounded use of each reference UI.
When references were reviewed, verify that the UX direction and reference UI use only the approved aspect-scoped recipe.
Show the draft first when the requested write surface, assignee, deadline tier, or public-safe boundary is ambiguous.
A request to draft is not permission to publish.

## 7. Write and verify Notion

Create the row from the default `QA 티켓` template.
Set `상태` to `신규`, leave `완료 여부` unchecked, retain the automatic requester and request date, and assign zero or one owner.
Fill only supported property values and put narrative detail in the page body.
Refetch the saved page after writing.
Verify the exact title, work type, personas, due date, assignee count, unchecked completion flag, URL, evidence references, and every required body section.
When a reference recipe was approved, verify that rejected candidates and unapproved requirements are absent from the saved body.
When browser editing is necessary, read the page again after every structural mutation because rendered block references can become stale.
Replace existing placeholder text by selecting the whole rendered block, and do not append a second body beside stale template content.
When a ticket contains an image, reopen the page, focus a rendered body block, move to the document end, and verify both the descriptive caption and the rendered image.
An upload placeholder or an initial snapshot that omits virtualized lower blocks is not persistence evidence.
Treat the write as incomplete until the refetched record matches the draft.

## 8. Publish a GitHub execution ticket

Use the repository [work-ticket template](../../.github/ISSUE_TEMPLATE/work-ticket.md) and the downstream [tickets skill](../../.claude/skills/tickets/SKILL.md).
Only `@GoBeromsu` and `@Lumiere001` may publish and assign a work ticket.
If the authorized actor cannot be verified, produce a draft and stop before publication.
Rewrite the contract for the public Issue instead of quoting the Notion body.
Use GitHub handles only and replace private URLs, data, screenshots, and identifiers with safe route patterns or synthetic examples.
Carry a reference URL into the Issue as text and leave its capture in Notion, because a third-party product screenshot does not belong in a public repository.
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

## Anti-patterns

- Writing a UX improvement as an implementation-first checklist → explain the current experience, user impact, goal, and expected flow before files or APIs.
- Copying reference links without interpretation → state the useful pattern and the bounded OSS Hub application for each reference.
- Continuing reference research after approval or retaining a rejected candidate → freeze the approved aspect-scoped recipe and keep only those patterns in the ticket.
- Creating a replacement row when the user supplied an existing ticket URL → update the named row, report any concurrent duplicate separately, and never delete it without approval.
- Capturing the whole screen and naming the target in prose → settle the selector first and capture that element alone.
- Listing a reference URL without its capture → the reader should judge the pattern inside the ticket, not by opening someone else's product.
- Restating a catalogued reference's URL and boundary inside a ticket → link [ux-reference-catalog.md](references/ux-reference-catalog.md) and keep the ticket to this screen's application.
- Running capture, anchor lookup, and dedup one after another → they share no input; launch them as concurrent lanes and reconcile the reports.
- Taking a lane's summary as evidence → require the file path, `file:line`, or row id behind each claim.
- Opening with a greeting that would fit any ticket → name this screen's friction and what changes for the reader.
- Treating an image placeholder as saved evidence → reopen the page and verify the caption and rendered image at the document end.

## Completion checklist

- [ ] The live Notion schema and default template were read.
- [ ] The functional or UX body variant was selected from evidence, and any user-edited reference ticket was reopened before drafting.
- [ ] If references were reviewed, only the approved aspect-scoped recipe remains in the final ticket.
- [ ] Duplicate QA rows were checked before creation.
- [ ] Every lane claim carried a checkable artifact, and anything without one is `확인 필요`.
- [ ] A separate fact-check pass cleared the draft, and no `REFUTED` claim remains.
- [ ] One screen or one output location and one logical change are covered.
- [ ] The body opens with a two-to-three-line note naming this screen's friction and what the ticket changes.
- [ ] Exactly one area is declared and the per-area minimum evidence is present.
- [ ] Every `frontend` capture is element-scoped and carries its selector, DOM path, URL, and observation time.
- [ ] Every reference UI carries a capture, and no third-party capture left Notion for a public surface.
- [ ] Work type, personas, one-or-zero assignee, and due date are evidence-backed.
- [ ] Missing legacy information is `미기록`, not inferred.
- [ ] The saved Notion page was refetched and matched.
- [ ] Any image present in the ticket was verified as rendered with its descriptive caption after reopening the page.
- [ ] Any GitHub Issue fills every repository template section, is independently executable, and passed the exact-text `ISSUE_TEXT` public-safe scan.
- [ ] Any legacy property deletion followed a complete source-to-body verification and explicit approval.
