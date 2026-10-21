# GitHub Issue QA ticket contract

[한국어](issue-ticket-contract.md) | **English**

English translation of the [Korean source](issue-ticket-contract.md).
The Korean document remains authoritative.
This file is an English reading reference; runtime skill loading continues to use the canonical [SKILL.md](../SKILL.md).
The Korean section headings and field markers in the templates are retained because they are part of the canonical ticket contract; the surrounding text and template instructions explain their English meanings.

A GitHub Issue is the sole canonical source for a QA or work ticket.
This document defines that Issue's title and body contract.
Values previously split into properties are kept only in the title, body sections, labels, assignee, and body `마감` (Deadline) line.

## Where information belongs

| Former property | Issue |
| --- | --- |
| `QA 항목` (QA item) | Title; new titles use `<명령형 할 일>` (an imperative task); GitHub `#번호` (#number) is the identifier |
| `문제 내용` (Problem description) | Body `## 문제` (Problem) |
| `Front URL` | Body `재현 URL` (Reproduction URL) line; full URL if safe, otherwise `해당 없음` (not applicable) if absent |
| `확인 역할` (Verified role) | Body `페르소나` (Persona) line; only evidence-supported choices from `교직원` (staff), `학생` (student), and `관리자` (administrator) |
| `분류 영역` (Classification area) | `영역` (Area) on the body's first fact line; one of `frontend`, `backend`, or `infra` |
| `상태` (Status) | Issue open/closed; create new tickets as open |
| `담당자` (Assignee) | Zero or one assignee, using only a GitHub @handle |
| `마감` (Deadline) | `마감:` line under body `## 우선순위와 기한` (Priority and deadline); 1, 3, or 5 business days from publication |
| `작업 유형` (Work type) | Apply only repository labels; no `feat`, `fix`, `refactor`, or `chore` labels exist |
| `완료 여부` (Completion status) | Omit; a person closes the Issue after deployment verification |
| `요청자` and `요청일` (Requester and request date) | Omit; the Issue author and creation time serve this purpose |
| `증거` (Evidence) | Attach in the body or provide a reproduction path; do not put unapproved third-party captures in public Issues |
| `GitHub Issue` URL | Omit; the Issue itself is canonical |

The default label is the repository's existing `ticket` label.
Record `작업 유형` only as `작업 유형: feat|fix|refactor|chore` on one line before body `## 작업 계약` (Work contract), not as a label.
Do not create missing labels.
Add repository labels other than `ticket`—such as `bug`, `documentation`, `enhancement`, or `question`—only when their meaning agrees with the evidence.

## Identifiers and duplicate lookup

A new ticket is identified by the `#번호` (#number) assigned by GitHub.
Do not count `QA<n>` identifiers or assign the next number manually.
Do not rewrite existing `QA<n>` titles to follow this rule.

Find duplicates by searching open and closed Issues for the symptom, path, and role.

```bash
gh issue list --repo JNU-SWCU/oss-hub --state all --search "<증상 또는 경로>" --limit 50 --json number,title,state
```

The search placeholder means “symptom or path.”
If an Issue has the same symptom, path, and role, edit or reference that `#번호` rather than creating another.

## Choosing the body

Use the functional-defect body when a directly observed result contradicts expected behavior.
Use the UX-improvement body when an existing flow works but is difficult, fragmented, unclear, or unnecessarily costly for the user.
When the user supplies a manually edited reference ticket, its section order and sentence density are the local style baseline.
When the user reviews UI references, keep only the approved pattern for each sub-flow and leave rejected candidates outside the final ticket.
Do not combine both bodies mechanically.
Keep only the reproduction detail needed to understand and verify the named problem.

## Title

The title rules apply only to future tickets.
Do not change existing GitHub Issue titles to follow them.

The format is `<명령형 할 일>` (an imperative task).
GitHub `#번호` is the identifier; do not add `QA<n>` to the title.
Write one line in the Korean imperative ending in `~하세요`, stating what the assignee must do.
A priority prefix such as `[P1]` or `[P2]` may precede the instruction; aim for no more than 40 characters excluding the prefix.
Put the symptom in the body's `문제` (Problem) section, not in the title.

- Bad: `프로그램 신청과 팀 구성이 분리된 화면·흐름으로 흩어져 있어 한 번에 끝나지 않는다` — “Program application and team formation are scattered across separate screens and flows, so they cannot be completed in one go.”
- Good: `분산된 프로그램 신청 흐름을 한 화면에서 끝내세요` — “Complete the fragmented program application flow on one screen.”
- Bad: `[P1] 프로그램 신청과 팀 구성이 분리된 화면·흐름으로 흩어져 있어 한 번에 끝나지 않는다` — the same symptom description with a priority prefix.
- Good: `[P1] 분산된 프로그램 신청 흐름을 한 화면에서 끝내세요` — the same imperative task with a priority prefix.

Leave existing `QA<n>` titles unchanged rather than rewriting them as examples.

## Opening

Begin the body with a 2–3-line opening before the first heading.
First identify the inconvenience the reader may already experience on this screen, then say what this ticket changes and point to the evidence.
A greeting that fits any ticket is filler, not an opening.
Do not include praise for work that has not yet been done.
Keep the opening to no more than 3 lines; move excess content into `문제`.

## Evidence by area

Choose only one `영역` (Area); it determines the evidence the ticket must provide.
If a ticket spans two areas, split it because it would have two evidence contracts.

| Area | Minimum evidence | Capture |
| --- | --- | --- |
| `frontend` | Target element's CSS selector, DOM path, full URL, and verification time | Required: an image cropped to that element only |
| `backend` | Request method and path, request-body summary, response status code, response-body summary, and one relevant log line | Required for logic changes: a [flow diagram](../../submit-pr-evidence/references/backend-diagram.en.md) |
| `infra` | Configuration file path, name of the value to change, deployment stage, verification command, and its output | Not required |

Use synthetic examples for all `backend` and `infra` values.
Do not include real tokens, real host addresses, personal information, or private repository paths in any area.
Do not invent evidence that has not been directly executed and observed; leave it as `확인 필요` (verification needed).

### Refactoring tickets based only on source inspection

Use source evidence for behavior-preserving refactoring that makes no claim of a UI defect.
Record links pinned to the inspected commit SHA, actual production entry points and consumers, a file → responsibility → new location move table, and static, re-export, and dynamic reachability evidence for deletion candidates.
Distinguish type-only edges from runtime edges, test-owned source from production source, and static deletion evidence from actual execution results.
Do not invent selectors, DOM paths, or captures for nonexistent screen defects.
Only in this case, use the inspected SHA instead of `main` in the file links below to preserve the source as it was reviewed.

After implementation, record before/after invariants for the URLs, permissions, requests, parsing, errors, and input state to preserve, together with actual verification results for the final SHA.
When replacing source-string checks, remove existing checks only after verifying successful and violating cases at the actual serializer, validator, or HTTP boundary.
If a screen-orchestration module moved, run the affected existing isolated browser E2E tests and report them separately from static checks and manual verification.
Do not report unexecuted checks as passes.

### Frontend capture procedure

The selector comes before the capture.
Identify the target element in the browser, confirm its CSS selector and DOM path, then capture only that element's region.
Capturing the whole screen and explaining the location in a caption does not satisfy this contract.
If the selector cannot be confirmed, do not pass it along as `미기록` (not recorded); hold the capture and mark it `확인 필요`.
The same rule applies to captures in `현재 화면` (Current screen) and `참고 UI` (Reference UI).
Put captures near the beginning: `현재 화면` immediately follows `재현` (Reproduction) in functional-defect tickets and `문제` in UX or design tickets.
If captures are at the end, assignees see the problem screen only after reading the entire ticket.
The selector written under `현재 화면` becomes the selector in the PR's `## Before / After` element row after implementation ([frontend-capture.md](../../submit-pr-evidence/references/frontend-capture.en.md)); the ticket author determines in advance which element the assignee will capture again.

## File path links

Write file paths as clickable links; rule 10 in [readability.md](../../submit-pr-evidence/references/readability.en.md) is the canonical general rule.
Link the backtick-formatted path to its GitHub URL: `` [`<경로>:<줄>`](https://github.com/JNU-SWCU/oss-hub/blob/main/<경로>#L<줄>) ``.
Here, `경로` means path and `줄` means line.
Use `#L356` for one line and `#L28-L46` for a range, and always fix the branch to `main`.
Before creating a link, actually open that file at that line and confirm it supports the body claim; line numbers shift with every merge.
Do not turn an unverified anchor into a link; leave it as `확인 필요`.
Evidence consisting only of a commit hash is not clickable; replace it with a link in the format above or remove it.

## Readability

[readability.md](../../submit-pr-evidence/references/readability.en.md) is the sole canonical source for bullets, paragraphs, and emphasis; do not repeat those rules here.

## What not to put in the body

- Generic blockquote boilerplate that would fit any ticket.
  Examples: `> 한 화면 또는 한 산출물 위치·한 논리 변경만 다룹니다.` (“This covers only one screen or artifact location and one logical change”) and `> 실데이터·개인정보가 보이는 캡처는 첨부하지 않습니다.` (“Do not attach captures showing real data or personal information”).
- Declarations of exceptions to skill rules.
  Replace them with instructions the assignee can use.
  - Bad: `영역 통합은 스킬 규칙('두 영역이면 분리')에 대한 PM 명시 승인 예외다.` — “Combining areas is an exception explicitly approved by the PM to the skill rule 'split two areas.'”
  - Good: `이 티켓은 화면과 API를 함께 바꾼다. frontend·backend 변경을 한 PR에 담되 「하지 않을 것」의 파일 경계를 넘지 않는다.` — “This ticket changes the screen and API together. Include frontend and backend changes in one PR without crossing the file boundary in Non-goals.”
- Internal pipeline remnants, such as `qa-dom-capture 확인 필요` (“qa-dom-capture verification needed”), `미기록`, or process paragraphs explaining a held capture: meta statements addressed to the ticket author rather than the assignee.

## Functional defect body

Copy and fill in this template for a functional-defect ticket.
The fixed Korean headings mean Problem, Reproduction, Current screen, Work contract, Tasks, Non-goals (this ticket's boundary), and Completion criteria.
The field markers mean Area, Persona, Reproduction URL, Conditions, Actual, Expected, Evidence, Capture, and Prerequisite dependencies.
Keep those headings and markers unchanged in the ticket.

```text
<2–3 lines for the person taking this ticket: the inconvenience they may experience on this screen now, what this ticket changes, and where the evidence is>

## 문제
- 영역: <frontend | backend | infra>
- 페르소나: <교직원 | 학생 | 관리자>
- 재현 URL: <the full `https://jnu-oss-hub.com/<path>` URL or 해당 없음>

<One paragraph, written as prose rather than bullets.>
<Connect the user's situation and intended action, the conditions and behavior encountered, and the cost this creates.>
<Do not write a hypothesized cause or fix here; write only what was observed.>

## 재현
- 조건: <login, permissions, and data state>
1. <First action>
2. <Next action>
3. <Where the problem appears>
- 실제: <Directly observed result>
- 기대: <Result that should appear in normal operation>
- 증거: <Attachment, verified branch@SHA, and time>

## 현재 화면
<For `frontend` tickets only; put the element showing the problem here.>
<Image cropped by selector, with no personal information or real data>
- selector: <Captured element's CSS selector>
- DOM path: <Full path from body to that element>
- 캡처: <Full URL> @ <Verification time>

## 작업 계약
- 선행 의존성: <None or a ticket>

#### 할 일
- [ ] <Required implementation scope>

#### 하지 않을 것 (이 티켓의 경계)
- <Scope this ticket will not touch>

#### 완료 조건
- [ ] When <persona> performs <action>, they see <verifiable result>.
- [ ] Recheck in the deployed environment (`https://jnu-oss-hub.com/<path>`).
- [ ] Check every item in the [UX anti-pattern](../../submit-pr-evidence/references/ux-antipatterns.en.md) assessment table and include it in the PR body.
```

The persona options are staff (`교직원`), student (`학생`), and administrator (`관리자`); `해당 없음` means not applicable.

## UX or design improvement body

Copy and fill in this template for a UX or design improvement ticket.
In addition to the shared markers above, the headings mean UX direction, Expected flow, Reference UI, Minimum requirements, Completion criteria, and Scope.
The additional field markers mean Reference point, OSS Hub application, Starting point, and Related contracts.
Keep those headings and markers unchanged in the ticket.

```text
<2–3 lines for the person taking this ticket: the inconvenience they may experience on this screen now, what this ticket changes, and where the evidence is>

## 문제
- 영역: <frontend | backend | infra>
- 페르소나: <교직원 | 학생 | 관리자>
- 재현 URL: <Full URL or 해당 없음>
<One paragraph, written as prose rather than bullets.>
<Connect what is difficult to understand or do on the current screen with the decision cost, omission risk, or repeated work that difficulty creates.>
<End with one sentence each describing the experience this ticket aims to create and an explicit non-goal.>

## 현재 화면
<Caption explaining what the current screen shows and why it is difficult to judge>
<Image cropped by selector, with no personal information or real data>
- selector: <Captured element's CSS selector>
- DOM path: <Full path from body to that element>
- 캡처: <Full URL> @ <Verification time>

## UX 방향
- <How to simplify the information structure and primary task>
- <How to make save, cancel, errors, empty states, or feedback understandable>
- <Interaction principles to preserve for keyboard use and narrow screens>

## 기대 흐름
1. <Where the user starts and what they do>
2. <Key information they check or enter along the way>
3. <Verifiable result after saving or completing>
4. <Result after cancellation, failure, or an empty state>

## 참고 UI
### <Product or pattern name>
<Full reference URL>
<Image cropped to only the element showing that pattern>
- selector: <Captured element's CSS selector>
- 참고 포인트: <The interaction or information structure ultimately selected>
- OSS Hub 적용: <How to limit that pattern to this screen, including what will not be brought over>

## 최소 요구
- [ ] <Required user-visible scope>
- [ ] <Error, empty-state, keyboard, or responsive requirements>

## 완료 조건
- [ ] When <persona> performs <action>, they see <observable result>.
- [ ] After failure, cancellation, or refresh, <state that must be preserved or restored> is correct.
- [ ] Empty states, no results, and errors are distinguishable.
- [ ] Recheck keyboard operation and a 390px screen in the deployed environment (`https://jnu-oss-hub.com/<path>`).
- [ ] Check every item in the [UX anti-pattern](../../submit-pr-evidence/references/ux-antipatterns.en.md) assessment table and include it in the PR body.

## 작업 범위
- 시작 지점: <File or screen region confirmed by inspection>
- 관련 계약: <Completed Issue, reused component, or prerequisite dependency>
- <Adjacent screen, API, schema, repository lifecycle, or permission boundary that will not change>
```

## Missing information

Use `미기록` when a legacy source does not contain the required fact.
Use `해당 없음` only when the fact is known not to apply.
Do not leave an angle-bracket placeholder in a published ticket.
