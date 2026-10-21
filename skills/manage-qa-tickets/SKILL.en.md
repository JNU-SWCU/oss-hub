---
name: "manage-qa-tickets"
description: >-
  Open this skill when drafting OSS Hub QA tickets outside the repository, checking them against open and closed GitHub Issues, and publishing them with `gh issue create`.
  Use it for requests such as “create a QA ticket,” “make this problem a ticket,” “rewrite the ticket,” “publish it as an issue,” and `oss-hub 티켓 #123 진행해줘` (“work on oss-hub ticket #123”).
  New titles are imperative tasks. GitHub `#번호` (#number) is the identifier. Do not change already published titles.
  Implementation and PR evidence belong to submit-pr-evidence, release QA to run-release-qa, and comments to write-github-comment.
metadata:
  version: "5.0.2"
---

# Manage QA tickets

[한국어](SKILL.md) | **English**

English translation of the [Korean source](SKILL.md).
The Korean document remains authoritative.
This file is an English reading reference; runtime skill loading continues to use the canonical `SKILL.md`.
Korean section names and marker strings are retained where they form the ticket contract, with their English meanings explained in the text.

A GitHub Issue is the sole canonical source for a QA or work ticket.
Observations go into a draft outside the repository, that draft becomes a public Issue, and a PR that stays within the contract closes that Issue.
Do not create rows in another repository, mirror Issues, or write their URLs back elsewhere.

The two stages belong in one skill because their contract is **the same**, not because it changes between stages.
The draft's `할 일` (Tasks), `하지 않을 것 (이 티켓의 경계)` (Non-goals: this ticket's boundary), and `완료 조건` (Completion criteria) become the same three sections in the Issue, and those sections define the PR's scope.
If the three versions diverge, the ticket becomes impossible to execute; this skill keeps one contract's content unchanged as its form moves from draft to Issue to PR.

## Canonical locations

| Information | Canonical source | What is kept elsewhere |
| --- | --- | --- |
| QA observations, evidence, and execution contract | GitHub Issue | Nothing; the draft file is temporary until publication |
| Progress | GitHub Issue and PR | Nothing |

Copies silently diverge when their source changes, and work following a diverged copy is only discovered during review.

## Identify the stage first

| User request | Stage | Procedure |
| --- | --- | --- |
| “Create a QA ticket,” “make this problem a ticket,” “rewrite the ticket” | 1. Draft | [§1](#1-draft--write-the-draft-outside-the-repository) |
| “Publish it as a GitHub issue,” “publish this draft” | 2. Publish | [§2](#2-publish--turn-the-draft-into-a-github-issue) |
| A draft just verified in stage 1 | 2. Publish | Continue from stage 1 to [§2](#2-publish--turn-the-draft-into-a-github-issue) without another request |
| “Work on oss-hub ticket #123” | Execute | [§3](#3-execute--turn-the-issue-into-a-pr), which routes to [submit-pr-evidence](../submit-pr-evidence/SKILL.en.md) |
| “Run release QA,” “find defects” | — | `run-release-qa`, not this skill |
| “Open a PR,” or a PR for a change without a ticket | — | `submit-pr-evidence`, not this skill |
| “Post a comment,” or a review reply | — | `write-github-comment`, not this skill |

Do not begin preparations for an inapplicable stage, such as capture lanes, a publication draft, or implementation.
If only execution is requested, pass the Issue number to submit-pr-evidence without repeating drafting and publication.
Once a draft passes verification, stage 1 continues directly into stage 2.
“Create a ticket” also requests publication of that ticket as an Issue.
Do not skip stages when continuing.
Creating an Issue without duplicate lookup and fact-checking creates a second Issue for the same problem.

## Who can do this

**Any team member can draft and publish tickets.**
Previously, only two people could publish them, but when the person who observes a problem cannot write its ticket, the observation disappears into conversation.
This criterion is not an authorization check that must pass before publication.
The public surface is protected by a public-safe check of every body, not by the publisher's identity.
Therefore, inability to identify the publisher does not block publication; leave the assignee empty and record whose request it was in the report.

Broadening publication rights does not broaden these two permissions:

- There must be zero or one assignee, and assigning someone else requires the user to state in this conversation that the person consented.
  The agent does not ask for consent on the user's behalf, and leaves the assignee empty without that evidence.
  Self-assignment is always allowed.
- Only a ticket's author or assignee may replace its body or close its Issue.
  Others make suggestions in a [comment](../write-github-comment/SKILL.en.md).

## Common guardrails

1. Before any write, check the prohibited public content in the [public-safety checker](../../scripts/check-public-safe.sh).
2. While managing tickets, do not change product code, deployment state, accounts, or test data.
   Implementation in the execution stage is the exception, and its scope is the ticket contract.
3. A screen ticket covers one screen and one logical change; a ticket without a screen covers one artifact location and one logical change.
4. Do not put real data, personal information, credentials, or private repository details on any surface.
5. Do not infer unrecorded roles, reproduction steps, expected results, dependencies, or implementation boundaries.
   Use `미기록` (not recorded) for absent information and `확인 필요` (verification needed) for information that could not be verified.
6. Do not create or edit Issues that the user did not request.
   A request to see a draft is not permission to publish it.
   Publication of a draft just verified here is the exception and is treated as part of the drafting request.
7. Do not rewrite already published GitHub Issue titles to follow the new title rules.
   The rules apply only to future tickets.
   The publication procedure in this skill does not itself authorize an external write for the current task.

## What this skill does not do

- Do not write tickets to databases or documents outside Issues.
- Do not mirror Issue bodies elsewhere or write a created Issue URL back into another property.
- Do not map user IDs from another system to GitHub handles.
  Use only an @handle supplied by the user for the assignee.
- Do not bulk-rewrite existing Issues to follow the new title rules.
- Do not add `QA<n>` to titles or `출처: QA<번호>` (Source: QA<number>) to bodies.
  GitHub `#번호` (#number) is the identifier.
- Do not put unapproved third-party product screenshots in public Issues.
  Keep only a written description of the pattern and a public URL on the public surface.

## 1. Draft — write the draft outside the repository

Write drafts only to temporary files outside the repository.
Committing a draft to the repository creates public history before the ticket exists.

### 1.1 Read the body contract

[issue-ticket-contract.md](references/issue-ticket-contract.en.md) is the canonical source for the fields and body contract.
A new ticket is identified by the `#번호` (#number) that GitHub assigns.
Do not count `QA<n>` identifiers or assign the next number manually.

### 1.2 Check for duplicates immediately before creation

Immediately before finalizing the draft as a publication file, search open and closed Issues again by symptom, path, and role.

```bash
gh issue list --repo JNU-SWCU/oss-hub --state all --search "<증상 또는 경로>" --limit 50 --json number,title,state
```

The search placeholder means “symptom or path.”
If any of the following matches an existing Issue, edit or reference that Issue rather than creating another:

- The core title phrase is the same, or one includes the other.
- The path, persona, and symptom summary are the same.
- The core problem statement describes the same failure, path, and role.
- The evidence points to the same baseline SHA or QA round.

A different hypothesis about the cause is not a reason to create a new Issue.
The same user-visible symptom and reproduction belong to the same ticket.

### 1.3 Normalize the facts

The title is `<명령형 할 일>` (an imperative task).
State what the assignee must do using the Korean imperative, and put the symptom in the body's `문제` (Problem) section.
Do not rewrite an existing Issue title into this format.

Choose one work type and record it in one body line: `작업 유형: feat|fix|refactor|chore` (Work type).
Do not create labels with these names; they do not exist in the repository.

- `fix`: observed behavior differs from expected behavior.
- `feat`: a requested user capability does not yet exist.
- `refactor`: internal structure changes without changing user-visible behavior.
- `chore`: tooling, operations, documentation, or maintenance work.

Declare one area, `frontend`, `backend`, or `infra`, on the body's first fact line.
The area determines the evidence the ticket must provide; the minimum evidence for each area is in [issue-ticket-contract.md](references/issue-ticket-contract.en.md).
If a request spans two areas, split it into two tickets instead of broadening the evidence contract.

Choose only a persona supported by evidence from `교직원` (staff), `학생` (student), and `관리자` (administrator); if none is recorded, put `미기록` on that line.
Preserve the full reproduction URL when it is safe to disclose, and use `해당 없음` (not applicable) only for work with no path.
Label evidence as a directly executed observation, an automated test, code inspection, or an unverified report.

### 1.4 Calculate the deadline

Calculate from the publication date, with the next business day as the first day counted.
Count Monday through Friday and account for holidays only when a trustworthy holiday calendar is available; otherwise state in the report that only weekends were excluded.
Put the date on the `마감:` (Deadline) line under `## 우선순위와 기한` (Priority and deadline).
The priority may be a title prefix: 1 business day = `P0`, 3 business days = `P1`, and 5 business days = `P2`.

Choose the shortest deadline justified by the observed impact.

- **1 business day**: security or personal information exposure, data loss or corruption, authorization bypass, or a release-blocking critical flow.
- **3 business days**: a reproducible functional, API, or infrastructure defect that does not qualify for the 1-day level.
- **5 business days**: non-release-blocking UX, design, accessibility, refactor, chore, or improvement work.

If the impact does not justify a priority, ask instead of guessing.

### 1.5 Collect evidence concurrently

Captures, code anchors, and duplicate lookup feed the body but do not feed one another.
Therefore, dispatch them concurrently to read-only subagent lanes rather than running them sequentially.
Start only one browser lane.
Two lanes using the same tab overwrite one another's screen.

[evidence-pipeline.md](references/evidence-pipeline.en.md) is the canonical source for lane composition, the capture procedure, the [`qa-dom-capture`](agents/qa-dom-capture.md) and [`qa-code-anchor`](agents/qa-code-anchor.md) agents, and what to do after receiving their reports.
The orchestrator performs duplicate lookup directly with `gh issue list --search`.
Give lanes a confirmed target rather than a judgment, and treat returned reports as claims rather than evidence.
Do not copy an item without a verifiable path, `경로:줄` (path:line), or Issue number into the body; leave it as `확인 필요`.

### 1.6 Write the body appropriate to the ticket type

Choose the body variant from [issue-ticket-contract.md](references/issue-ticket-contract.en.md).
The title, labels, assignee, and `마감` (Deadline) line support indexing and assignment; the body is the execution contract.
[issue-ticket-contract.md](references/issue-ticket-contract.en.md) is the canonical source for imperative titles, clickable file paths, nested bullets, and the list of process-meta sentences excluded from bodies.
[readability.md](../submit-pr-evidence/references/readability.en.md) is the canonical source for the readability rules themselves.
issue-ticket-contract.md also points to that document; the rules are not repeated here.
If the user identifies a manually edited reference ticket, reopen that Issue before drafting and match its section order, sentence density, and vocabulary.

Every body begins with an opening before the first heading.
Unless it starts from an inconvenience the reader already experiences on this screen, the ticket feels like someone else's problem.
The `여는 말` (Opening) section in [issue-ticket-contract.md](references/issue-ticket-contract.en.md) is the canonical source for the sentence rules.

For a **functional defect**, use a reproduction-centered body.
Write procedures only from observed behavior; do not reverse-engineer them from an assumed implementation.
If execution evidence is insufficient, write `확인 필요` instead of inventing it.

For a **UX or design improvement**, write a body meant for people to read.
Explain the current experience, user cost, and intended outcome before listing implementation tasks.
Then write the current screen, UX direction, expected flow, reference UI, minimum requirements, completion criteria, and scope in that order.

Reference UI must pair a public URL with a sentence describing the pattern to borrow.
Do not put unapproved third-party product screenshots in public Issues.
For repeatedly cited products, check [ux-reference-catalog.md](references/ux-reference-catalog.en.md) first; if the product is listed, link to the catalog instead of rewriting its URL and boundaries.
Consider only about two to four candidates with actual screens, and prefer familiar standard patterns over unfamiliar products for ordinary CRUD, file, or date flows.
For each candidate, record what to borrow, what not to bring over, and the OSS Hub boundary, and obtain approval per sub-flow.
After approval, freeze that combination, stop exploring, and remove rejected candidates from the ticket.

For `frontend` tickets, the selector comes before the capture.
A full-screen capture with a caption describing the location forces readers to find the relevant part again every time.
The `frontend 캡처 절차` (Frontend capture procedure) in [issue-ticket-contract.md](references/issue-ticket-contract.en.md) is the canonical procedure.
Put captures near the start of the body.
For functional defects, put them immediately after `재현` (Reproduction); for UX or design tickets, immediately after `문제` (Problem).
If they are at the end, assignees see the problem screen only after reading the entire ticket.
The selector in the `현재 화면` (Current screen) caption is reused unchanged in the PR's `## Before / After` element row after this ticket is implemented ([frontend-capture.md](../submit-pr-evidence/references/frontend-capture.en.md)).
This determines at ticket-writing time which element the assignee must capture again.
This capture requirement applies only to OSS Hub's own screens.

For both variants, write completion criteria in a form the named persona can observe, and state the narrowest non-goals.

Screen tickets must include a [UX anti-pattern](../submit-pr-evidence/references/ux-antipatterns.en.md) check in their completion criteria.
Without that requirement, the assignee implements only what was requested and the same anti-pattern appears on the next screen.
This list is for inclusion in tickets, not merely for objections during review.
In ticket bodies, write reproduction and verification URLs in full as `https://jnu-oss-hub.com/<path>` so readers can click them directly.

### 1.7 Verify with another reviewer before writing

Before creating an Issue, send the completed draft to [`qa-fact-checker`](agents/qa-fact-checker.md).
The lane that produced a claim does not approve that claim.
Checking one's own draft inherits the draft's assumptions.
Do not publish while any `REFUTED` claim remains unfixed; retain `UNVERIFIED` claims in the body as `확인 필요`.

Check that the title, work type, persona, deadline level, body facts, required scope (`할 일` for functional defects or `최소 요구` for UX), completion criteria, and boundary (`하지 않을 것` for functional defects or `작업 범위` for UX) agree.
These markers mean Tasks, Minimum requirements, Non-goals, and Scope, respectively.
Show the draft first if the assignee, deadline level, or public-safety boundary is ambiguous.

Run the public-safety check against that same draft file.
Use the exact text to be published, not a summary.

```bash
ISSUE_TEXT="$(cat <draft-file>)" bash scripts/check-public-safe.sh --text-only
```

Fix flagged strings in the draft file, then check the same file again.

### 1.8 Reread and reconcile the draft file

Keep the draft file outside the repository.
There must be zero or one assignee using a GitHub @handle, a body `마감:` line, and the three execution contracts.
Do not publish with angle-bracket placeholders remaining.

After writing, reread the file and check the title, work type, persona, deadline, assignee count, URLs, and all required body sections.
Drafting is not complete until the reread record matches the intent.

Once it matches, continue to [§2](#2-publish--turn-the-draft-into-a-github-issue) without stopping.
Stop here and report why only if the user asked to see a draft alone, said not to publish this draft, or publication conditions are unmet.

## 2. Publish — turn the draft into a GitHub Issue

Publication does not rewrite the draft; it shapes the checked draft into the [work-ticket template](../../docs/translations/work-ticket.en.md) and passes it to `gh issue create`.
[github-publication.md](references/github-publication.en.md) is the canonical source for publication timing, labels, assignees, capture-admission criteria, and readback.

The essential points are:

- Publish a just-verified draft immediately after stage 1.
  Edit an existing Issue only when the user identifies it.
- Put the [work-ticket template](../../docs/translations/work-ticket.en.md)'s `## 시작` (Start) block at the very beginning of the body, word for word.
  Do not add `QA<n>` to the title.
- If the three execution contracts—required scope, boundary, and completion criteria—are absent from the draft, strengthen the draft first rather than filling them in on the Issue.
  Refer to people only by GitHub @handle.
- OSS Hub's own element captures may go into an Issue after passing the personal-information check.
  Do not put unapproved third-party captures in public Issues; keep only the pattern description and public URL.
- The default label is the repository's existing `ticket` label.
  Do not create missing labels.
- Use zero or one assignee, using a GitHub handle supplied by the user.

```bash
gh issue create --repo JNU-SWCU/oss-hub \
  --title "<명령형 할 일>" \
  --body-file <body-file> \
  --label ticket \
  --assignee <github-handle>
```

After creation, reread the Issue.

```bash
gh issue view <number> --repo JNU-SWCU/oss-hub --json title,body,labels,assignees,state,url
```

Check that the title, body, `ticket` label, assignee, and `마감` line match the draft.
If they do not, correct that Issue and reread it.
Do not create another new Issue.

## 3. Execute — turn the Issue into a PR

When asked `oss-hub 티켓 #<번호> 진행해줘` (work on oss-hub ticket #<number>), confirm that the Issue exists, then hand it to [submit-pr-evidence](../submit-pr-evidence/SKILL.en.md).
That skill is the canonical source for contract parsing, implementation scope, demonstrated completion criteria, area-specific evidence, and the PR body.
Do not duplicate or execute its capture, interview, or PR checklist here.
A PR without a ticket also belongs to submit-pr-evidence, not this stage.

## Anti-patterns

- Splitting ticket drafting, publication, and execution back into separately named active skills → keep one contract's draft, Issue, and PR under `manage-qa-tickets`, separating only detailed procedures into references.
- Creating an Issue before duplicate lookup → the same problem becomes a second Issue.
  Perform stage 1 first.
- Editing the body differently from the draft during publication → the checked text and published text diverge.
  Fix flagged sentences in the draft file and check again.
- Writing only a draft and postponing publication until another request → that request often never comes.
  Continue to publication when verification finishes.
- Not rereading a created Issue → missing labels, assignees, or body content remain public.
- Starting a UX improvement with an implementation checklist → describe the current experience, user impact, goal, and expected flow before files or APIs.
- Listing reference links without interpretation → describe each reference's useful pattern and limited OSS Hub application.
- Putting unapproved third-party captures in public Issues → describe the pattern in words and link only the public URL.
- Continuing to search for references after approval or retaining rejected candidates → freeze the approved combination and remove the rest.
- Creating a new Issue when the user supplied an existing ticket URL → edit the identified Issue, report any separate duplicate, and do not close it without approval.
- Capturing the entire screen and describing the target in a caption → confirm the selector first and capture only that element.
- Running capture, anchors, and duplicate lookup sequentially in one lane → use concurrent lanes because they do not share inputs.
  Only duplicate lookup is performed by the orchestrator with `gh issue list --search`.
- Accepting a lane summary as evidence → require a path, `경로:줄` (path:line), or Issue number behind every claim.
- Adding an “improvement” to the PR that required scope (`할 일` or `최소 요구`) did not request → remove it and propose a separate ticket.
- Checking completion criteria without running the work → actually run it first, then check them.
- Starting future titles with a symptom description or adding `QA<n>` → use only `<명령형 할 일>` and put the symptom in the body's `문제` section.
  The identifier is `#번호`.
- Rewriting published QA titles to match the new rules → apply the rules only to future writing.
- Duplicating execution procedures or the PR evidence checklist in this skill → route to the single [submit-pr-evidence](../submit-pr-evidence/SKILL.en.md) source.
- Creating a label absent from the repository → apply only `ticket` and report it.

## Completion checklist

Items for drafting (stage 1):

- [ ] Read the body contract and did not assign `QA<n>` manually.
- [ ] Rechecked duplicates with `gh issue list --search` immediately before creation.
- [ ] The draft exists only in a temporary file outside the repository.
- [ ] Chose the body variant based on evidence and reopened any reference Issue identified by the user.
- [ ] Every lane claim has a verifiable artifact; those without one are marked `확인 필요`.
- [ ] Passed a separate fact-check, with no `REFUTED` claims remaining.
- [ ] Passed the `ISSUE_TEXT` public-safe check using the complete draft.
- [ ] Covers only one screen or artifact location and one logical change.
- [ ] The body starts with a 2–3-line opening identifying this screen's inconvenience.
- [ ] The new title is `<명령형 할 일>` and no existing title was changed.
- [ ] Declares one area and provides the minimum evidence for that area.
- [ ] Every `frontend` capture is an element-level capture of OSS Hub's own screen, with a selector, DOM path, URL, and verification time.
- [ ] Reference UI in the public Issue contains pattern descriptions and public URLs only, with no unapproved third-party captures.
- [ ] The selector in the `현재 화면` caption can be reused unchanged in the PR Before/After.
- [ ] Evidence supports the work type, persona, zero or one assignee, and `마감` line.

Items for publication (stage 2):

- [ ] Passed the checked body file to `gh issue create`, adding only the `## 시작` block at the beginning.
- [ ] The three execution contracts—required scope, boundary, and completion criteria—were present in the draft and transferred unchanged.
- [ ] Labels already exist in the repository, with `ticket` as the default.
- [ ] There are zero or one assignees using GitHub handles supplied by the user.
- [ ] Reread the title, body, labels, assignee, and `마감` line with `gh issue view` and matched them to the draft.

Items for execution:

- [ ] Passed the Issue number to [submit-pr-evidence](../submit-pr-evidence/SKILL.en.md) without duplicating the PR evidence procedure in this skill.
