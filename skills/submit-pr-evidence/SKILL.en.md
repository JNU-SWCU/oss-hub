---
name: submit-pr-evidence
description: >-
  Open immediately before creating an OSS Hub PR or writing its body, including
  before `gh pr create` or `gh pr edit`, and for requests to open, submit, or request a merge for a PR.
  Use even for ticketless, documentation-only, or one-line changes.
  Require a minimal implementation and evidence for each applicable area against the Issue contract
  or the user-approved ticketless scope, completion criteria, exclusions, and reason.
  Block PR submission if that evidence is missing.
  Use write-github-comment for comments, manage-qa-tickets for QA tickets, and run-release-qa for release QA.
metadata:
  version: "1.14.0"
---

# Submit PR Evidence

[한국어](SKILL.md) | **English**

English translation of the [Korean source](SKILL.md).
The Korean document remains authoritative.
This is a reading reference; skill execution continues to use `SKILL.md`.
Checker-sensitive Korean headings and phrases below are retained verbatim and explained in English.

Do not open an OSS Hub PR without evidence.
Success means the PR exactly matches the contract, every applicable completion criterion is demonstrated before opening it, and no files outside the boundary are changed.

## Output contract

The deliverable is a PR body file that passes `scripts/check-pr-body.sh` and `scripts/check-public-safe.sh`.
Its first line is `Closes #<번호>`, `Refs #<번호>`, or a nonempty `티켓 없음 — <이유>` (“No ticket — <reason>”; `<번호>` means the issue number).
Use `Closes` when this PR satisfies every Issue completion criterion.
Use `Refs` when the evidenced PR scope can be merged but Issue obligations remain.
Do not replace an existing Issue with `티켓 없음` (“No ticket”).
Include the applicable Before/After evidence, flow diagram, and verification links in the body; start only inapplicable sections with the exemption phrases below.
If applicable evidence cannot be produced, do not open the PR, do not create an Issue, and do not turn an uncaptured screen into an exemption.

## Work surfaces

This skill owns only the PR body and evidence gate.
Hand other surfaces to the appropriate skill without starting this procedure's interview, capture, or installation steps.

| Surface | This skill | Contract | Interview | Capture | Diagram | Antipatterns |
| --- | --- | --- | --- | --- | --- | --- |
| Ticketless documentation-only or configuration PR | Yes | No-ticket line + approved scope, completion criteria, and exclusions | No | Exemption reason | Exemption reason | Exemption reason |
| PR that changes a screen | Yes | Issue or no ticket | Only unanswered intent | Required | If logic changes | Required |
| Nonvisual browser routing or runtime boundary (rendered components unchanged) | Yes | Issue or no ticket | No | Required (behavior table) | If logic changes | Exemption reason |
| Backend logic + consuming screen | Yes | Issue or no ticket | Only unanswered screen questions | Required | Required | Required |
| Backend logic, no screen | Yes | Issue or no ticket | No | Exemption reason | Required | Exemption reason |
| QA solely for a release report | No — `run-release-qa` | — | — | — | — | — |
| PR or Issue comments only | No — `write-github-comment` | — | — | — | — | — |

Do not ask again for scope, completion criteria, or exclusions already provided.
Do not block documentation or configuration PRs with UI questions.

## Contract

For a numbered Issue, use `gh issue view <번호>` to read only the following three sections.
For ticketless work, do not look up or create an Issue.
Proceed only after receiving the user-approved scope, completion criteria, exclusions, and reason for having no ticket.
Do not invent an Issue to publish local work.
An Issue reserving a shared path is not a QA or implementation ticket created by this skill.

The section names below apply to tickets issued on or after 2026-09-02; older tickets use the names in parentheses.

- `할 일` (formerly `최소 요구 (기능)`) — “Work to do” (formerly “Minimum requirements (functionality)”): the minimum scope to implement.
- `완료 조건` (formerly `완료 조건 (기능 검증)`) — “Completion criteria” (formerly “Completion criteria (functional verification)”): what must actually be demonstrated before opening the PR.
- `하지 않을 것 (이 티켓의 경계)` (formerly `절대 금지 (이 티켓의 경계)`) — “Exclusions (this ticket's boundary)” (formerly “Strict prohibitions (this ticket's boundary)”): files and behavior that must not be changed.

Do not start implementation if any of the three sections is empty.
An empty `하지 않을 것` means exclusions are unrecorded, not that there is no boundary.
If `선행 의존성` (“Prerequisite dependencies”) is unmet or cyclic, report the ticket number without starting a partial implementation.

Before writing code, read the [root AGENTS.md](../../AGENTS.en.md) and applicable nested AGENTS.md files.
The authoritative security and PR-scope rules are [docs/rules/security.md](../../docs/rules/security.en.md) and [docs/rules/pr-scope.md](../../docs/rules/pr-scope.en.md).
Implement only `할 일` and make zero changes to paths listed under `하지 않을 것`.
Check each completion criterion only after actually running it.

**A green result does not mean anything ran.**
The workspace names are `backend` and `frontend`.
Filtering by a nonexistent name makes pnpm exit with code 0 without running anything.
A path following an array flag can be consumed as an ignore value.
Record the suite and test counts actually executed in the verification report; do not claim a pass without those counts.
Keep these counts only in the PR body's `## 검증` (“Verification”) section, not in review replies ([review reply principles](../write-github-comment/SKILL.en.md#write-what-a-green-check-hides-not-what-it-already-says)).
Lint and typecheck can pass while rebase leftovers return old code first; only the full tests catch that case.

## Evidence gate

After demonstrating the completion criteria, require only evidence that **actually applies** to the change.
Block submission if applicable evidence is missing.
Exempt inapplicable sections only with an exemption phrase and a nonempty reason.
An uncaptured screen, a state that could not be opened, or a flow that could not be drawn is not an exemption.

A person decides applicability by reviewing the diff.
`scripts/check-pr-body.sh` checks only body formatting; it does not determine applicability.

### Screens, browsers, and consuming screens → captures

Before/After applies when a change touches a user-visible screen, browser behavior, or a screen rendering a response changed by the backend.
Even for backend-only changes, capture the screen consuming that API.
If a response changes but the screen looks identical, that fact is itself useful review information.
Before/After also applies when only browser routing or a runtime boundary changes, even if there is no changed rendered component.
Do not use `Before/After 없음` (“No Before/After”) in that case.
If captures cannot be produced, stop rather than putting N/A in the body.
There is no general screenshot exemption.

Common requirements: actual Before/After images, full-screen After captures at desktop and 390x844, a `https://jnu-oss-hub.com/<path>` verification link, source SHA, route, viewport, and synthetic state in captions, a human public-safety review, and public attachments.
If the isolated origin differs, state the difference.
Do not claim that the full URL is identical or that this is a new execution.

The authoritative branches, tables, captions, and publication procedure are in [references/frontend-capture.md](references/frontend-capture.en.md).

- **Visual or component change** — A `| 요소 |` (“Element”) row is required for each changed component; capture Before and After using the same selector.
  If the ticket has a `현재 화면` (“Current screen”) selector, reuse it unchanged.
- **Nonvisual browser change** — Routing or runtime boundary changes with rendered components unchanged.
  Do not invent element rows.
  Start `## Before / After` with `비시각 브라우저 변경 — <비어 있지 않은 이유>` (“Nonvisual browser change — <nonempty reason>”) and use a `| 동작 |` (“Behavior”) table for actual browser/API behavior and full-screen attachments.
  This declaration is not an exemption.

For multiple states, additionally capture applicable empty, no-results, and error states.
A local path is not an attachment.
The authoritative element-selector procedure for the visual branch is manage-qa-tickets' `qa-dom-capture`.
The capture environment is defined in [references/evidence-harness.md](references/evidence-harness.en.md).
Use Aside CLI for manual checks and the existing Playwright entry point for automated regressions; neither replaces the other.
Routine checks use `pnpm dev` connected to the real backend.
Do not build a preview server or a backend-free emulator.

### Backend logic → flow diagram

If any branch, state transition, authorization path, retry handling, call order, or layer boundary changes, put a Mermaid diagram (preferred) or DOT diagram under `## 흐름 다이어그램` (“Flow diagram”).
The first diagram shows entry → decision → result with at most eight nodes.
Put details in `<details>`.
Rules are in [references/backend-diagram.md](references/backend-diagram.en.md).
When applicable, do not substitute an approximate diagram; block submission if it is missing.

### Inapplicable sections

Capture, diagram, and antipattern requirements do not apply when only scripts, CI, documentation, or configuration changes and there is no user-visible screen or backend-flow change.
Browser routing and runtime boundary changes do not qualify even if the screen looks identical.
Only then, leave one line with an exemption phrase and a nonempty reason.

## Screen UX and diff review

When a screen is in scope, pass all twenty-four items in [references/ux-antipatterns.md](references/ux-antipatterns.en.md).
Put the verdict table inside `<details>`.
Fix violations before opening the PR.
Create a separate ticket only for violations outside the boundary.

Every PR requires a diff review appropriate to its scope.
Remove excess implementation without reducing verification, error handling, security, or accessibility.
If ponytail is already installed, `/ponytail-review` may perform the same check.
Do not install it if absent.
Repository rules take precedence over conflicting review suggestions.
Do not report ponytail as “passed” without evidence.

## Interview

Ask the author only when a screen is in scope and the following answers have not already been provided.
The agent must not answer on the author's behalf.
Do not repeat answered questions or block a documentation PR with screen questions.

1. **Intent** — “What is the main thing a person using this screen wants to do here? Please answer in one sentence.”
   Ask again if the answer merely copies the ticket wording.
2. **Awkwardness** — “You just tried clicking through it yourself. Was anything awkward? If not, which paths did you try before reaching that conclusion?”
   “None” without an account of the tested path means it has not been checked.
3. **Antipatterns** — “Which of the [twenty-four items](references/ux-antipatterns.en.md) especially matter on this screen, and why?”

Place answer 1 under `## 무엇이 좋아지나` (“What improves”), answer 2 under `## 이 흐름이 자연스러운가` (“Does this flow feel natural”), and answer 3 on the last line of `## UX 안티패턴 점검` (“UX antipattern review”).
Do not polish away the author's manner of expression.
If answer 2 identifies awkwardness, fix it before opening the PR and record it in `## 내가 고친 UX 문제` (“UX issues I fixed”).

If an answer reverses the Issue's direction, make the correction, rewrite `할 일` in the ticket body to reflect the new direction, and remove the old-direction code, constants, and tests.
For ticketless work, do not create an Issue; proceed only after agreeing again with the user on scope, completion criteria, and exclusions.

## Local gate

- **`corepack pnpm exec prettier --check .` must pass.** The hook checks the entire repository.

## PR body order

There is one runtime template: [`.github/pull_request_template.md`](../../docs/translations/pull-request-template.en.md) (English reading guide).
[`scripts/check-pr-body.sh`](../../scripts/check-pr-body.sh) checks section headings and exemption phrases character for character.

Put what a person needs to read first; place what the diff already says later.

- `Closes #<번호>` · `Refs #<번호>` · `티켓 없음 — <이유>` — Open directly with the contract.
  Use Closes if Issue completion criteria are met, Refs if the evidenced PR scope can be merged but Issue obligations remain, and no ticket only when no ticket exists.
- `## 무엇이 좋아지나` — Who can now do what.
- `## 바로 확인` — Paths a reviewer can try (“Check directly”).
- `## Before / After` — Demonstrate screens with a table and images.
- `## 이 흐름이 자연스러운가` / `## 내가 고친 UX 문제`
- `## UX 안티패턴 점검`
- `## 흐름 다이어그램` / `## 검증`
- `## 정리` — “Summary,” always last in the body.
  On the `- 디자인 규격:` (“Design specification”) line, list the shared components and tokens used by this PR and their specification sources (component-card names in docs/design.md or Figma component links).
  If new colors or controls were built directly, state that and why.

Use exemption phrases only when inapplicable: one line starting with the exact string below and a nonempty reason.
Do not use them for applicable evidence that could not be produced.
`비시각 브라우저 변경 — <이유>` is not an exemption; keep that declaration and the `| 동작 |` table inside Before/After.

- Check directly: `확인 링크 없음 — <산출물 위치 또는 이유>` (“No verification link — <deliverable location or reason>”).
- Before / After: `Before/After 없음 — <이유>` (“No Before/After — <reason>”).
- Does this flow feel natural: `화면 없음 — <이유>` (“No screen — <reason>”).
- UX issues I fixed: `화면 없음 — <이유>`.
- UX antipattern review: `UX 안티패턴 해당 없음 — <이유>` (“UX antipatterns do not apply — <reason>”).
- Flow diagram: `흐름 다이어그램 없음 — <이유>` (“No flow diagram — <reason>”).
- Summary's design specification: `화면 변경 없음 — <이유>` (“No screen change — <reason>”).

An empty `내가 고친 UX 문제` section means the flow was not tried directly.
If there were zero issues, describe what was reviewed and why there was no issue.

First write the body to a file outside the repository and pass `bash scripts/check-pr-body.sh <본문 파일>`.
The Claude Code hook blocks `gh pr create` for a body that has not passed.
Other runtimes do not have that hook, so this step and the template checkboxes are the safeguard.

## PR writing principles

### Write the opening paragraph in the persona's language

- Write `## 무엇이 좋아지나` in terms of “who can now do what,” rather than “what was fixed.”
  - Bad: “Milestone editing was separated into an independent Radix Dialog.”
  - Good: “When staff edit a milestone in program editing, they work in a layer separate from page scrolling and return to their original position after saving.”
- Put component and library names in the details section.

### Describe verification as behavior a person checked

- Numbers alone do not explain what is guaranteed.
- Next to the numbers, state which user behavior they establish.

### Keep local-environment noise out of the body

- If needed, use write-github-comment for missing `node_modules`, Windows EPERM, and unrelated existing warnings.
- Keep verification that could not be executed in the body.

### Readability

The authoritative guide is [references/readability.md](references/readability.en.md).
Pass its final self-check before publishing.

### Do not open with unattached placeholders

- `<!-- 첨부 대기: … -->` (“Attachment pending”) means the evidence gate has not passed.
- If an applicable capture cannot be made, stop submission instead of leaving a comment.

### Re-read the rendered body before opening

- `\title` renders as a tab followed by `itle`.
- After opening, check again that backslashes, backticks, tables, and images render as intended.

## Open the PR

1. Run `bash scripts/check-public-safe.sh` to check changed files and commit messages for public-safety violations.
   This is a PUBLIC repository, so apply the same standard to bodies and comments.
   For text only, use `--text-only` from [references/public-safety-check.md](references/public-safety-check.en.md).
2. Open with `gh pr create --body-file <경로>`.
   [AGENTS.md](../../AGENTS.en.md) defines branch names and commit format.
   After opening, read the body back with `gh pr view <n> --json body`.
3. After opening, move the corresponding card to In Review on the [project board](https://github.com/orgs/JNU-SWCU/projects/1).
   For a ticketless PR, do not create a nonexistent card.
4. If the PR references an Issue with `Closes` or `Refs`, GitHub provides the link; do not post the PR URL as an Issue comment.

## Review reply principles

write-github-comment is authoritative for replies to review findings, UX proposals, and Issue progress comments.
This document retains one PR-body rule: **`## 검증` is not finished when the PR opens.**
Update that section when checks are rerun.

## When to stop

- Unmet or cyclic prerequisite dependency → Report the number and stop.
  The issuer owns dependency corrections.
- Applicable evidence cannot be produced → Stop without substituting speculative images, mockups, approximate diagrams, or exemption phrases.
- The contract is silent on a point required for implementation → Ask the user instead of inferring from memory of past tickets.
- The three execution-contract sections are empty → Do not implement until they are filled.
- Ticketless work lacks scope, completion criteria, exclusions, or a reason → Obtain them from the user without creating an Issue.

## Do not

- Put a local file path in the body and call it an attachment.
- Commit evidence images to a product branch ([pr-scope.md](../../docs/rules/pr-scope.en.md) §1).
- Create an evidence-only branch.
- Create a new evidence Release with `gh release create`.
  Follow [frontend-capture.md](references/frontend-capture.en.md#upload-assets-to-an-already-published-release) to add files to an existing Release.
- Put evidence in `/artifacts/`.
- Substitute mockups, Figma, test output, or code diffs for running screens or actual flows.
- Build backend-free review servers, compatibility flags, or emulator catalogs.
- Turn an applicable capture failure into `Before/After 없음`.
- Invent `| 요소 |` rows for components that were not rendered.
- Use `Before/After 없음` or N/A for nonvisual browser changes.
- Hide isolated-origin differences or claim identical full URLs or a new execution.

## Requirements

- `gh` — View Issues when they exist, create PRs, and move board cards.
- `git` — The branch and commit workflow in [AGENTS.md](../../AGENTS.en.md).
- `bash scripts/check-public-safe.sh`
- `bash scripts/check-pr-body.sh <본문 파일>`
- For applicable manual screen checks, the installed Aside CLI (`aside`, `aside repl`).
  Do not invent nonexistent commands.
- For applicable automated browser regressions, the existing `pnpm --filter frontend e2e`.

## Completion checklist

- [ ] For an Issue, I read the three contract sections and use `Closes #<번호>` when all completion criteria are met, or `Refs #<번호>` when the evidenced PR scope is mergeable but Issue obligations remain. For ticketless work, there is an approved scope, completion criteria, exclusions, and `티켓 없음 — <이유>`. I did not describe an existing Issue as ticketless. I did not start with unmet or cyclic prerequisites.
- [ ] I read the root and applicable nested AGENTS.md before the first edit.
- [ ] I changed zero prohibited paths.
- [ ] I demonstrated every completion criterion with actual evidence.
- [ ] Where screen/browser evidence applies, Before/After exists. Visual changes use `| 요소 |` rows with identical selectors; nonvisual browser changes use `비시각 브라우저 변경 — <이유>` and a `| 동작 |` table. Actual Before/After images and desktop/390x844 After captures are publicly attached, with SHA, route, viewport, synthetic state, and isolated-origin differences recorded. A person checked public safety and metadata. I did not exempt an uncaptured applicable screen or replace it with N/A.
- [ ] Where screens/browsers are in scope, there is a `https://jnu-oss-hub.com/<path>` verification link.
- [ ] Only inapplicable sections use an exemption phrase and a nonempty reason.
- [ ] For an applicable screen, all twenty-four [UX antipattern](references/ux-antipatterns.en.md) rows contain evidence inside `<details>`, and violations were fixed before opening.
- [ ] I removed excess implementation from the diff and did not install ponytail just to run it.
- [ ] For applicable backend logic, I put Mermaid or DOT under `## 흐름 다이어그램` without real data or secrets in nodes.
- [ ] I ran `bash scripts/check-public-safe.sh`.
- [ ] I opened the PR using the AGENTS.md workflow and moved an existing board card to In Review.
- [ ] If the PR points to an Issue, I did not repost the PR URL as an Issue comment.
- [ ] I asked only previously unanswered interview questions for applicable screens, with zero answers supplied by the agent on the author's behalf.
- [ ] I wrote `## 무엇이 좋아지나` and, when a screen exists, `## 이 흐름이 자연스러운가` as one prose paragraph each.
- [ ] `## 정리` is last in the body.
- [ ] The `- 디자인 규격:` line under `## 정리` lists shared components, tokens, and specification sources, or uses the exemption phrase if there is no screen change.
- [ ] `## 내가 고친 UX 문제` is filled, or uses the exemption phrase if there is no screen.
- [ ] There are zero unattached placeholder comments.
- [ ] `bash scripts/check-pr-body.sh <본문 파일>` passed.
- [ ] After opening, I read the body back with `gh pr view <n> --json body` and checked that images render.
- [ ] The first line states the conclusion — I passed the [readability.md](references/readability.en.md) self-check.
