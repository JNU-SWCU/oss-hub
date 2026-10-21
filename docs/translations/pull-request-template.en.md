# Pull Request Template — English Reading Guide

[한국어](../../.github/pull_request_template.md) | **English**

English translation of the [Korean source](../../.github/pull_request_template.md).
The Korean document remains authoritative.
This is a reading guide, not an additional GitHub template.
The Korean section headings, exemption prefixes, and checklist strings below are exact submission-checker inputs; retain them when submitting a PR.
Use the original template for a copyable submission body.

[submit-pr-evidence](../../skills/submit-pr-evidence/SKILL.en.md) owns this format; complete its procedure before opening a PR.
Follow the common [readability rules](../../skills/submit-pr-evidence/references/readability.en.md).

Start with `Closes #<number>` if this PR satisfies every Issue completion criterion.
Use `Refs #<number>` if the evidenced PR scope can merge but Issue obligations remain.
For ticketless work, confirm user-approved scope, completion criteria, and exclusions, then use the exact prefix `티켓 없음 — ` followed by a nonempty reason.
Do not classify an existing Issue as ticketless.
Use the exemption phrases below only when the evidence genuinely does not apply.
Missing required captures/diagrams blocks submission; it is not an exemption.

## 무엇이 좋아지나

*What improves*

Write one prose paragraph describing the user's situation and what the change lets them do.
Keep implementation means such as component/library names out of this section.

`<One paragraph>`

## 바로 확인

*Check directly*

Provide a link the reviewer can open immediately.
If there is no deployed screen to check, replace the section body with `확인 링크 없음 — ` followed by the artifact location or reason.

[OSS Hub](https://jnu-oss-hub.com/) route `https://jnu-oss-hub.com/<path>` · `<persona>` · `<verification time>`

Path clicked directly: `<sign in → … → go back>`.
States checked: `<normal / empty / no results / error, as applicable>`.

## Before / After

Fill this section when UI/browser behavior changes or a screen consumes a changed API response; `submit-pr-evidence` owns applicability.
For visual changes, element rows come first and are mandatory: one per changed component.
Use the same selector for Before and After; reuse the ticket's `현재 화면` selector if provided.
Link the two full-screen captures below the table, not inside it.
If screen evidence is inapplicable, replace the section body with `Before/After 없음 — ` and a reason.

For browser behavior changes without rendering changes, follow frontend-capture.md's nonvisual contract.
Use `비시각 브라우저 변경 — ` with a nonempty reason and the exact table header `| 동작 | Before | After |`.
Real full-screen Before/After captures and browser/API behavior evidence are required; do not invent elements or waive the evidence.

| 요소 | Before | After |
| --- | --- | --- |
| `<selector>` | `<img width="480" alt="<What this element showed Before>" src="https://github.com/JNU-SWCU/oss-hub/releases/download/<tag>/<issue>-before-element-<what>.png">` | `<img width="480" alt="<What changed After>" src="…-after-element-<what>.png">` |

<sub>`<selector>` · `<DOM path>` · `/<route>` · 1440x900 · Before `<base sha>` / After `<head sha>` · synthetic data</sub>

Full-screen After: desktop 1440x900 and 390x844, each with its attachment URL.

## 이 흐름이 자연스러운가

*Does this flow feel natural?*

In one prose paragraph, describe awkward points found by clicking through and the basis for the judgment.
If none were found, state the path actually clicked to reach that conclusion.
Without a screen, use `화면 없음 — ` and a reason.

`<One paragraph>`

## 내가 고친 UX 문제

*UX problems I fixed*

Without a screen, use `화면 없음 — ` and a reason.
An empty table means not directly tried, not no issue; for zero findings, explain what was reviewed and why no issue was found.

| Awkward point | Why it is a problem | How it was fixed |
| --- | --- | --- |

## UX 안티패턴 점검

*UX anti-pattern check*

Use the exact 24-row judgment-table format from `skills/submit-pr-evidence/references/ux-antipatterns.md`, including AP-21–24.
Put the table inside `<details>`; a blank line between summary and table is optional.
If inapplicable, use `UX 안티패턴 해당 없음 — ` with a reason outside `<details>`.

<details><summary>24-row judgment table</summary>

`<Judgment table>`

</details>

Items especially important on this screen: `<number and a one-sentence reason>`.

## 흐름 다이어그램

*Flow diagram*

Fill this only when backend logic changes: branches, state transitions, authorization, retries, call order, or layering boundaries.
The first diagram is high-level (entry → decision → result, no more than eight nodes); put details inside `<details>`.
`skills/submit-pr-evidence/references/backend-diagram.md` owns the requirements.
If inapplicable, use `흐름 다이어그램 없음 — ` with a reason.

The following text shows the Mermaid template; replace placeholders before using it as a Mermaid diagram.

```text
flowchart LR
  A[<Entry: who requests what>] --> B{<Decision>}
  B -->|<Condition>| C[<Result 1>]
  B -->|<Condition>| D[<Result 2>]
```

<details><summary>Details</summary>

```text
<Fields, guards, and call order>
```

</details>

## 검증

*Verification*

Provide commands another person can copy and execute, with the currently expected results.
State both observed behavior and test counts.
Update this section after correcting findings and rerunning checks; it is not finished when the PR opens.

- `<Behavior checked by a person>` — `<user outcome it establishes>`.
- `<Test count>` — `<user behavior established by that count>`.

## 정리

*Wrap-up*

Use “none” for inapplicable exclusions, reviewer decisions, or environment prerequisites.
Check all four checkboxes below.
For design specifications, name shared components/tokens and their source (docs/design.md component-card name or Figma component link).
If new colors or controls were created directly, explain what and why.
With no screen changes, use `화면 변경 없음 — ` followed by a reason.

- `이번에 하지 않은 것:` `<scope left outside the ticket and why / none>`.
- `리뷰어가 결정해 줘야 하는 것:` `<question / none>`.
- `환경 전제:` `<new env/migration/manual procedure / none>`.
- `디자인 규격:` shared components/tokens and specification source, or `화면 변경 없음 — ` followed by a reason.
- [ ] 로컬 커밋을 전부 push했다
- [ ] `bash scripts/check-public-safe.sh`를 통과했고 본문·캡처에 실명·비밀값·내부 호스트·로컬 경로가 없다
- [ ] `bash scripts/check-pr-body.sh <본문 파일>`을 통과했다
- [ ] submit-pr-evidence 절차를 수행했다

The four exact checkbox strings mean: all local commits pushed; public-safe passed with no real names/secrets/internal hosts/local paths in the body/captures; PR-body checker passed; submit-pr-evidence completed.
