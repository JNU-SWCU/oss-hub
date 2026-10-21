# UX Antipattern Checklist

[한국어](ux-antipatterns.md) | **English**

English translation of the [Korean source](ux-antipatterns.md).
The Korean document remains authoritative.

These 24 items must pass before opening a PR that changes a screen and before writing a screen ticket.
Each item is written as a **question whose answer is already determined**, so the rules can be followed without prior UX training or knowledge of antipattern names.
Four require counting; the remaining twenty require opening the screen and reading the questions.

The basis is [Nielsen's 10 usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) and the [references](#references) at the end.
Rather than reproducing the principles, this checklist narrows them to forms actually observed in OSS Hub screens.

## Why this list exists

A submission-status screen displayed the following within one viewport:

```text
[Statistics]  Submitted 0/N │ Not submitted: N items │ Nothing submitted: 5 teams │ Late: 0 items
[Filters]     All: 5 teams │ Including missing submissions: 5 teams │ Nothing submitted: 5 teams
[Caption]     Showing 5 of 5 items on this page (5 total)
```

`전체 미제출 5팀` (“nothing submitted: 5 teams”) appeared **literally twice**, in statistics and filters, while `전체` (“all”) meant all **teams**, all **documents**, and all **items** across three labels.
The author worked on the two components separately and missed that they stood together on one screen; all automated checks passed.
Rules that depend on human attention silently leak this way, so count what can be counted.

## A. Four checks that only require counting

Open the deployed screen and paste the following into the devtools console.
It does not depend on repository code and runs unchanged in any environment.

In hidden tabs, `offsetParent` and `getBoundingClientRect` values can all be zero, breaking visibility detection.
Use computed styles instead of layout so the check also works in hidden tabs.
The executable snippet retains Korean comments, interface text, and output markers; the table below explains the four checks in English.

```js
(() => {
  // 반응형 때문에 DOM에 두 벌 있는 내비게이션을 중복으로 세지 않는다
  const hidden = (el) => { let n = el;
    while (n && n.nodeType === 1) { const s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden') return true; n = n.parentElement; }
    return false; };
  const vis = (el) => {
    const c = el.cloneNode(true);
    c.querySelectorAll('.sr-only,[aria-hidden="true"]').forEach((n) => n.remove());
    return (c.textContent ?? '').replace(/\s+/g, ' ').trim();
  };
  const out = [];

  // AP-1 중복 사실 — 표 본문을 뺀 요약 표면에서 같은 문구가 두 번 이상.
  const seen = new Map();
  document.querySelectorAll('dd,dt,button,h1,h2,h3,p,span,li').forEach((el) => {
    if (el.closest('tbody') || el.querySelector('dd,button,p,li')) return;
    if (hidden(el)) return;
    const t = vis(el);
    if (t.length < 4) return;
    seen.set(t, (seen.get(t) ?? 0) + 1);
  });
  for (const [t, n] of seen) if (n > 1) out.push(`AP-1 중복 사실 — 「${t}」 ${n}회`);

  // AP-8 수 반복 — 한 문장이 같은 수를 세 번 이상.
  document.querySelectorAll('p,li,caption,figcaption').forEach((el) => {
    const t = vis(el);
    const nums = t.match(/\d+/g) ?? [];
    const c = new Map();
    nums.forEach((d) => c.set(d, (c.get(d) ?? 0) + 1));
    for (const [d, n] of c) if (n >= 3) out.push(`AP-8 수 반복 — 「${t}」가 ${d}을 ${n}번`);
  });

  document.querySelectorAll('[role="group"],[role="tablist"]').forEach((g) => {
    const opts = [...g.querySelectorAll('[aria-pressed],[aria-selected],[role="tab"]')];
    // AP-4 상태 과잉표시 — 눌린 컨트롤이 시각 변형·ARIA 위에 상태를 텍스트로 또 말한다.
    opts.forEach((o) => {
      const on = o.getAttribute('aria-pressed') === 'true' || o.getAttribute('aria-selected') === 'true';
      if (on && /선택됨|선택|활성|현재/.test(vis(o))) out.push(`AP-4 상태 과잉표시 — 「${vis(o)}」`);
    });
    // AP-7 무력한 컨트롤 — 선택지의 수가 전부 같아 눌러도 결과가 같다.
    const nums = opts.map((o) => (vis(o).match(/\d+/) ?? [])[0]);
    if (opts.length > 1 && nums.every((n) => n !== undefined && n === nums[0]))
      out.push(`AP-7 무력한 컨트롤 — 선택지 ${opts.length}개가 전부 ${nums[0]}`);
  });

  console.log(out.length ? out.join('\n') : '자동 점검 4종 통과 (중복 문구·상태 과잉표시·무력한 컨트롤·수 반복)');
})();
```

| # | Name | Trigger | Heuristic |
| --- | --- | --- | --- |
| AP-1 | Duplicate facts | The same wording appears verbatim in at least two summary locations | #8 Aesthetic and minimalist design |
| AP-4 | Excessive state labeling | A pressed control restates its state in text on top of visual styling and ARIA | #8 |
| AP-7 | Ineffective controls | Every option has the same count, but the screen does not acknowledge that fact | #6 Recognition rather than recall |
| AP-8 | Repeated numbers | One sentence states the same number at least three times | #8 |

Paste the output into the PR body unchanged; do not transcribe it manually.
**Passing is not approval.**
These four checks do not cover the four judgment-based checks, so always read the pass message as “only the four automated checks passed.”

## B. Four questions to read with the screen open

No UX knowledge is required.
Read the following questions as written to find the answer.

### AP-2. Overloaded terms — heuristic #4, Consistency and standards

> How often does the same word appear on this screen, and **what does it refer to each time**?

Using `전체` (“all”) three times to mean all teams, all documents, and all items is a violation.
Fix it by naming the thing being described: `전체 5팀` → `참여 팀 5` (“5 participating teams”); `전체 미제출 5팀` → `한 장도 안 낸 팀 5` (“5 teams that have submitted nothing”).

### AP-3. Mixed units — heuristic #4

> Can someone identify **the denominator of adjacent numbers** from the screen alone?

If `미제출 N건` (“N unsubmitted items”) stands beside `전체 미제출 N팀` (“N teams with nothing submitted”), the reader must count to understand what is an item and what is a team.
Use one unit within a group; if different units are necessary, split the groups.

### AP-5. Actions expressed as prose — heuristic #6, Recognition rather than recall

> If this explanation disappeared, **would there be something the user could no longer do**?

If so, that location needs a control, not a sentence.
`빠른 필터·페이지와 무관하게 이 마일스톤의 전체 팀을 담습니다` (“Includes every team in this milestone, regardless of quick filters or page”) placates the need to “download with filters applied” using prose.
The conclusion of NN/g's [Command Links](https://www.nngroup.com/articles/command-links/) applies directly: **buttons are better for primary commands**.
Use explanations only to supplement what controls do, never to replace controls.

### AP-6. Exposed internal terminology — heuristic #2, Match between the system and the real world

> If you read this copy aloud to a faculty/staff member visiting for the first time today, **would they ask a follow-up question**?

`1인 팀 계속` (“continue as a one-person team”) prompts questions: if all participation is through teams, a “one-person team” need not be a separate concept; it is just a team.
When storage concepts such as a single-member team record, seed ID, or enum name leak into copy, users must learn product internals to read the screen.

### Do not label every match a violation

AP-1 targets **stating the same fact twice on a summary surface**.
It does not target structural repetition: a section heading for each milestone, calendar labels repeated on each week row for a period spanning multiple weeks, or the same sentence shown twice because two items have no guidance.
Calling these violations fills the verdict table with noise and buries real duplication.

**Open each console match individually**, distinguish the two cases, and include a piece of observed evidence in the verdict table explaining your decision.

## C. Eight patterns observed on edit and detail screens

A and B inspect **copy and numbers** within a screen; these eight inspect **structure and behavior**.
All were actually encountered on program edit/detail screens in 2026-09, and none of the four automated checks detected them.

### AP-9. Dead controls — heuristic #1, Visibility of system status

> When you click everything that looks clickable, **does anything do nothing**?

A single-milestone editor rendered an `aria-pressed="true"` selector even though there was only one possible scope, while its caller passed `onActiveIdChange={() => undefined}`.
The screen suggested an action, the screen reader announced a pressed button, and keyboard users lost a tab stop.
There are two fixes: make it actually work, or do not render a selector when there is only one option.
Putting a gray border around a display-only element and hiding behind `disabled` is not an answer; it still does not explain why the control cannot be used.

### AP-10. Remnants of removed features — heuristic #2, Match between the system and the real world

> Does this screen refer to a concept **the product has already removed**?

After classification was consolidated into curricular/extracurricular, the edit screen still displayed “Application form · Basic application / Form version v1” and explained that it could not be changed there.
Displaying something unchangeable and then saying it cannot be changed consumes space twice.
However, **removing something from a screen and removing it from the domain are different tasks**: if the application screen still reads that form, remove only the display and retain the contract.

### AP-11. Unlabeled times — heuristic #6, Recognition rather than recall

> From that line alone, can someone tell whether a displayed date is **the start or the deadline**?

A milestone card showing only `2026년 8월 20일 23:59` (“20 August 2026, 23:59”) does not reveal whether submission starts or ends then.
Add `시작` (“start”) and `마감` (“deadline”) labels, and present ranges as ranges.
If only the deadline is intentionally shown, its label must say so; do not make users infer internal time conventions such as Seoul/UTC beside the numbers.

### AP-12. Mixed authorship — heuristic #4, Consistency and standards

> Can someone distinguish **who wrote this paragraph**, the operator or the product, from the screen alone?

An operator-written milestone notice appeared as the same gray paragraph style as developer-added guidance saying “Drag the handle to the left of the item to reorder.”
Users gave both equal weight and mistook the notice they needed to read for explanatory copy.
Group operator-written content in a named area (“Operator notice”), and place product guidance next to its control.

### AP-13. Inverted disclosure — heuristic #8, Aesthetic and minimalist design

> Has the screen collapsed **content to read** while leaving **editing tools** expanded?

The edit screen collapsed submission items while a rarely used calendar permanently occupied half the page and displaced other content.
The default should be the reverse: **current state stays visible; tools open when a change is needed**.
Progressive disclosure determines what to collapse: hide rarely used elements and show frequently viewed content.

### AP-14. Fragmented editing — heuristic #4

> Does **the way to edit the same thing vary between screens**?

A milestone was split between an Edit dialog for name, schedule, and notice and immediately saved submission items below the card.
Explaining that split required the sentence “Manage this in the submission items below.”
**A sentence explaining the structure is a signal that the structure, not the sentence, is wrong**—the other side of AP-5.
Creation and editing screens share field composition, labels, and validation; this does not require copying the interaction flow as well.

### AP-15. Mismatched save scope — heuristic #3, User control and freedom

> Does the scope saved and reverted by **Save and Cancel** match what the screen presents?

If some fields in one editor save immediately while others wait for Save, Cancel cannot undo what the user expects.
Unifying the scope is the rule; if that is impossible, **do not present both as if they were unified**.
Always disclose irreversible results such as replacing files or deleting items; do not push partial-save management onto the user.

### AP-16. Unreachable content — heuristic #7, Flexibility and efficiency

> On a narrow screen, with long content and the keyboard open, **can the user reach every input and the bottom buttons**?

Attaching the submission-item editor as a separate scroll region outside the form compressed its content to 79px and made the milestone impossible to edit.
One editor must have **one scrolling owner**: keep its header/footer fixed and let the body use the remaining height.
Test with long Korean names at 390px width and reduced height to represent the keyboard.
Repeated icons need a 44px action target, an accessible name, and a tooltip.

| # | Name | Trigger | Basis |
| --- | --- | --- | --- |
| AP-9 | Dead controls | Looks clickable but clicking does nothing | Norman signifiers; WAI-ARIA APG Button |
| AP-10 | Remnants of removed features | A concept removed from the product remains on screen | Heuristic #2 |
| AP-11 | Unlabeled times | A date/time has no label explaining what it represents | Heuristic #6 |
| AP-12 | Mixed authorship | Operator content and product guidance look the same | Heuristic #4 |
| AP-13 | Inverted disclosure | Content to read is collapsed while editing tools remain expanded | NN/g Progressive Disclosure |
| AP-14 | Fragmented editing | The same object is edited differently across screens | Heuristic #4; GOV.UK Question pages |
| AP-15 | Mismatched save scope | The scope of Save/Cancel differs from what the screen presents | Heuristic #3; WCAG 3.3.4 |
| AP-16 | Unreachable content | Inputs or bottom buttons cannot be reached with narrow screens or long content | WCAG 2.5.8 |

## D. Four patterns “fixed” by adding words

A button communicates one action and one state by itself.
Explanations are added only when the button is insufficient.
A/B inspect copy and numbers, C inspects structure and behavior, and D inspects **the chosen method of fixing a problem**.
Covering review findings with extra copy makes the screen a little longer each time, and the next review starts with that longer screen.
All four were observed in 2026-09 submission/download screens (PR #1230).

### AP-17. Sentences explaining controls — heuristic #8, Aesthetic and minimalist design

> If this sentence disappeared, **would the adjacent button lose any meaning**?

Verified observation in `apps/frontend/src/features/programs/milestone-document-submission-form.tsx`:
An explanation in the file-error area said `위에서 다른 파일을 바로 선택하거나 파일 없이 계속할 수 있습니다.` (“Select another file above, or continue without a file”), immediately above the button `파일 없이 계속` (“Continue without a file”).
The same fact appeared once as prose and once as a control.
The automated AP-1 check in A detects **exact string matches only**, so this variation ending in `…할 수 있습니다` (“you can…”) passed; AP-17 covers that gap.
Labels follow the same rule, but `돌아가서 확인` (“go back and check”) is a repository-wide convention, not an isolated screen mistake.
At least three irreversible-confirmation dialogs use that label: `program-authoring-confirmation-dialog.tsx:36`, `application-confirmation-dialog.tsx:61`, and `milestone-document-resubmission-dialog.tsx:69`.
A design comment at `milestone-document-resubmission-dialog.tsx:15-16` explicitly defends it: “It says what you can do, rather than simply ‘Cancel.’”
PM decision (2026-09-08): the second button before irreversible confirmation has one action—close this dialog—and the dialog's position already communicates “go back.”
A label longer than one action is carrying a sentence.
The button states one action; its position states where the user returns.
**However, this is not a single-screen fix.**
Do not change only one dialog: changing a shared label requires updating every confirmation dialog using it and the design comment in `milestone-document-resubmission-dialog.tsx` in the same PR, or leaving it alone.
The owner must decide, so raise a ticket together with AP-20.

**Check before removing text**: before deleting a sentence, check whether its `id` is referenced by `aria-describedby` or `aria-labelledby`.
If so, the sentence is **addressed to screen-reader and keyboard users**, not only to sighted users; preserve its accessible name/description connection even if removing it visually, by moving it to `sr-only` or replacing it with `aria-label`.
Example: `표를 좌우로 스크롤할 수 있습니다.` (“You can scroll the table horizontally”) is referenced by `Table` through `aria-describedby` together with `tabIndex={0}`.
Removing it breaks the WCAG 2.1.1 contract (`apps/frontend/src/components/ui/table.tsx:19-27,38-41`, QA14/QA15).
**AP-17 asks for removal of sentences that make people reread what they have already seen, not sentences intended only for users who cannot see it.**

### AP-18. Sentences an icon already expresses — heuristic #8

> **Does one icon already communicate what this label does?**

Verified observation in `apps/frontend/src/features/programs/program-document-archive-panel.tsx`:
The expansion toggle label was `{open ? '다운로드 범위 닫기' : '제출 자료 ZIP 내려받기'}` (“close download scope” / “download submissions as ZIP”); inside it was `<h2>다운로드 범위</h2>` (“download scope”), and an option fieldset repeated it a third time in `<legend class="sr-only">다운로드 범위</legend>`.
A download icon already communicates downloading; X or a chevron communicates closing.
Fix repeated secondary controls such as close, download, and delete with icons, but **always provide accessible names**.
Keep visible text on the main CTA; icon-only controls are limited to a few universally understood actions.
The basis is NN/g Icon Usability, already included in the references.

The minimum requirement for an icon-only control is `aria-label`.
Existing repository examples apply `aria-hidden="true"` to the icon and `aria-label` to the `size="icon"` button: `consent-policy-document.tsx:52-66` (`aria-label="전문 닫기"`, “close full text”), `program-type-modal.tsx:51-60`, and `submission-dialog.tsx:59-68`.
The `Tooltip` primitive (`apps/frontend/src/components/ui/tooltip.tsx`) also has real consumers: icon-only edit/delete buttons in `program-milestone-card.tsx` combine `aria-label` and `Tooltip`.
Follow these examples by recommending both `aria-label` and `Tooltip` for repeated icons; require at least `aria-label` without exception.

### AP-19. Repeating the widget's contract — heuristic #4, Consistency and standards

> **Does the option text repeat a rule the widget already communicates?**

Verified observation in `apps/frontend/src/features/programs/program-document-archive-options.tsx`:
Radio options were `['MILESTONE', '마일스톤 하나']` and `['TEAM', '팀 하나']` (“one milestone” and “one team”).
A radio group permits one selection by definition; `하나` (“one”) restates that guarantee and lengthens every option label by one Korean character.
`마일스톤` and `팀` (“milestone” and “team”) are enough.
Unlike AP-4's repeated **selected state**, AP-19 repeats the **widget contract: how many items can be selected**.

### AP-20. Answering an unasked question — heuristic #2, Match between the system and the real world

> **Does a person in this role actually ask the question this screen answers?**

Observation: the “compare changed submissions and review again” screen in PR #1230 shows what changed in a submission.
PM review decision (2026-09-08): what faculty/staff ask there is “Does this submission match the required format?”, not “What changed?”
Removing a screen that answers an unasked question is cheaper than fixing it; polishing the copy creates no reason to read it.
Before editing copy, answer **who would be unable to do what if this screen did not exist**; if there is no answer, remove the screen.
This is a product decision, so **agents must raise a ticket/Issue for an owner decision rather than decide alone**.

| # | Name | Trigger | Basis |
| --- | --- | --- | --- |
| AP-17 | Sentences explaining controls | A sentence next to a button repeats what it does | Heuristic #8; NN/g Command Links |
| AP-18 | Sentences an icon already expresses | A label states in a sentence what an icon already communicates | NN/g Icon Usability |
| AP-19 | Repeating the widget's contract | Option text repeats the widget's selection rule | Heuristic #4; WAI-ARIA APG Radio Group |
| AP-20 | Answering an unasked question | The screen answers a question people in that role do not ask | Heuristic #2 |

## E. Three patterns observed in 2026-09 boards, confirmations, and access cards

A/B inspect wording and numbers, C structure and behavior, and D the chosen fix; E inspects **reading order on narrow screens, confirmations asking the same question, and committed versus proposed values**.
Inline comment layout itself, explanations of particular outcomes, and explicit action buttons next to status text are not inherently violations.
All were observed on 2026-09-23 when @GoBeromsu reviewed @Lumiere001's PRs #1376, #1374, and #1380.

### AP-21. Body text colliding with metadata on narrow screens — heuristic #8, Aesthetic and minimalist design (Gestalt proximity)

> At narrow widths, does user-written content collide with author/time metadata and confuse the reading order into name → body → time?

Inline comments are not inherently a violation; body and metadata may share one line on a wide screen.
Metadata wrapping onto another line is also not a violation.
A violation occurs when body text overlaps metadata or a sentence breaks awkwardly beside a name, making the body read as a caption for that name.

Observation: in PR #1376 at 390x844, the comment body `합성 답변: PDF 한 개로 올려 주세요.` (“Synthetic reply: please upload one PDF”) stood to the right of the author name/role badge on the same flex row.
The sentence broke midway beside the name, while the time occupied its own line below.
Reading order became name → body → time, and the body looked like a caption for the name.
Fix: the implemented header row contains author + badge + time; the body is a block beneath it.
Header metadata may wrap at narrow widths, but the body must not collide with that header or be cut mid-sentence beside it.
Verify this order at the viewport where the collision occurs; do not prohibit inline layout on wide screens.

### AP-22. Rewording a confirmation that asks the same question — heuristic #4, Consistency and standards

> An existing confirmation already asks “Discard unsaved changes?”; **have you reinvented its question and button meanings in different words**?

This does not mean every confirmation must use the same single-verb wording.
An explanation of consequences specific to this dialog, including what will be discarded, is valid.
A button need only express one action; a label describing this dialog's outcome need not match other dialogs character for character.

Observation: PR #1374 changed only the order and colors of buttons in the repository-URL cancel dialog while retaining different wording for the same question.
Its title was `변경사항을 저장하지 않고 돌아가겠습니까?` (“Return without saving changes?”), its description repeated `변경사항` (“changes”), and its buttons were `이어서 수정하기` / `변경사항 버리기` (“Continue editing” / “Discard changes”).
`main` already had the same question in `program-edit-milestone-dialog.tsx`: `저장하지 않은 변경을 버릴까요?` (“Discard unsaved changes?”), an sr-only description, and `계속 편집` / `버리기` (“Continue editing” / “Discard”) buttons.
Fix: if it is the same question, align its meaning and two branches—stay/discard—with the existing dialog.
When two dialogs exist, share the component or at least share the meaning of the question.
Keep explanations of content discarded only by this dialog if needed; do not lengthen the question with new unrelated sentences.
AP-17 handles labels carrying more than one action's worth of prose.
This item concerns only reinventing the same question in different words.

### AP-23. Controls with ambiguous current values and change results — heuristic #6, Recognition rather than recall, and #4

> Without reading and reasoning, is it clear **which value is committed now and which will be proposed by clicking**?

Not every binary value must use a `Switch`.
For consequential permission changes, status text plus an explicit action button is valid.
The button must say what it does, and the current value must be distinguishable from the proposed value.
A `Switch` usually implies immediate application.
When multiple options must be visible before choosing, a `Select` shows the current value and options together.
Do not remove accessible names or visible status text repeated to avoid communicating state through color alone.

Observation: PR #1380 replaced two-button radios with `허용됨  [회수]`, `없음  [허용]`, and `활성  [비활성화]` (“Granted [Revoke]”, “None [Grant]”, “Active [Deactivate]”).
Committed and proposed values appeared beside one another on a card, with the button label reversing according to state.
Users had to read the text, read the button, and infer which was current and which was the result of a change.
Fix: show committed and proposed values distinctly, and give accessible names that correctly identify a current value or proposed action.
Update the committed value only after the server succeeds; show pending and failed states in place.
For a blocked value, disable the control and put the reason next to it.
Do not disguise status as an executable button (R-31); this does not prohibit explicit action buttons next to status text.
This overlaps AP-9/AP-19: adjacent text must not repeat rules the control already communicates, but status text required for color independence remains.

| # | Name | Trigger | Basis |
| --- | --- | --- | --- |
| AP-21 | Body/metadata collision on narrow screens | At narrow widths, body overlaps metadata or breaks awkwardly mid-sentence and confuses reading order. Inline layout and metadata wrapping are excluded. | Heuristic #8; NN/g Proximity |
| AP-22 | Reworded confirmation for the same question | The meaning and stay/discard branches of the same question are reinvented in different wording. Dialog-specific consequences and different verb labels are excluded. | Heuristic #4; NN/g Confirmation Dialogs |
| AP-23 | Ambiguous current value and change result | Committed/proposed values are unclear, values update before success, or pending/failure is not visible. Status text plus explicit action buttons, Switch, or Select are not inherently violations. | Heuristics #6/#4; NN/g Toggle-Switch; WAI-ARIA APG Switch |

## F. One pattern observed in 2026-09 access-change dropdowns

After AP-23 exposed a button's inability to show its resulting state and moved the control to `Select`, the next issue emerged.
Putting options **in a list** makes it possible to see whether the values use the same kind of language.
With a single button, only one value is visible and there is no comparison, hiding this defect.

### AP-24. Mixed grammatical forms in options — heuristic #4, Consistency and standards, and #6, Recognition rather than recall

> When you **read the options aloud side by side**, are they all the same kind of expression?

Options name selectable **values**.
Name values with state nouns or property adjectives; buttons express actions with verbs.
Do not mix forms inside a control or across neighboring controls: otherwise users must first decide whether an option describes a state or an event that just happened.

Observation: three dropdowns in the “Change access” card were `없음 / 허용됨`, `없음 / 허용됨`, and `활성 / 비활성` (“None / Granted”, “None / Granted”, “Active / Inactive”).
`없음`, `활성`, and `비활성` describe current states, but `허용됨` alone describes the **event** of someone having granted access.
Because the three controls were stacked on one card, the mismatch was visible directly.
Fix: rename the possession state to `있음` (“Present”), so `있음 / 없음` and `활성 / 비활성` (“Present / Absent” and “Active / Inactive”) use matching forms.
`lib/status-vocabulary` is the source for wording, so change that vocabulary table rather than individual screens (R-35, R-41).

Do not revert to `허용` (“Grant”), which can be read as an action: it is a label left over from when this control was a button and reads as a command inside a list.
History lists that display past events (`승인` / `회수`, “Approval” / “Revocation”) are outside this item: in those lists, events are the values.

| # | Name | Trigger | Basis |
| --- | --- | --- | --- |
| AP-24 | Mixed grammatical forms in options | Options within one control, or neighboring controls, mix state nouns with `-됨`/`-함` predicate forms. History lists whose values are events are excluded. | Heuristics #4/#6; NN/g Listboxes vs. Dropdown Lists |

## Verdict table

Put this table directly into PR bodies and screen tickets.
A row containing only `통과` (“pass”) is unsupported and is treated as not passed; include a piece of evidence explaining the verdict.
Do not fill the evidence column with wording substitutions alone (“changed A to B”): state what was removed or replaced with a control.
The fixed Korean header `판정`/`근거` means verdict/evidence; keep the AP labels and verdict markers in their original form for automated checks.
`자동·통과` means automated/pass, `위반 → 고침` violation/fixed, `해당 없음` not applicable, and `위반 → 티켓 이관` violation/moved to a ticket.

```markdown
| # | 판정 | 근거 |
| --- | --- | --- |
| AP-1 중복 사실 | 자동·통과 | Console output |
| AP-2 겹친 용어 | 위반 → 고침 | `전체` meant teams, documents, and items; distinguished `참여 팀` (participating teams) from `한 장도 안 낸 팀` (teams with no submissions). |
| AP-3 단위 혼용 | 해당 없음 | This screen has no grouped numbers. |
| AP-4 상태 과잉표시 | 자동·통과 | Console output |
| AP-5 액션의 문장화 | 위반 → 고침 | Removed ZIP-scope prose and added a button to download with filters applied. |
| AP-6 내부 용어 | 위반 → 고침 | `1인 팀 계속` caused questions; removed the team concept from the label and changed it to `팀 없이 계속` (continue without a team). |
| AP-7 무력한 컨트롤 | 자동·통과 | Console output |
| AP-8 수 반복 | 자동·통과 | Console output |
| AP-9 죽은 컨트롤 | 위반 → 고침 | Removed an `aria-pressed` selector with only one scope and a no-op handler. |
| AP-10 사라진 기능의 잔상 | 해당 없음 | Every concept this screen describes exists in the current product. |
| AP-11 의미 없는 시각 | 위반 → 고침 | Added `시작`/`마감` (start/deadline) labels to a card previously showing only a deadline. |
| AP-12 뒤섞인 출처 | 위반 → 고침 | Grouped operator notices into a named area and moved interaction guidance next to the control. |
| AP-13 뒤집힌 노출 | 위반 → 고침 | Showed submission items by default and opened the calendar only on Edit. |
| AP-14 갈라진 편집 | 위반 → 고침 | Combined metadata and submission items into one editing session and removed the explanation. |
| AP-15 어긋난 저장 범위 | 위반 → 고침 | Removed immediate saves; canceling before Save now causes zero server changes. |
| AP-16 닿지 않는 본문 | 위반 → 고침 | Fixed the 79px body collapse and verified reachability at 390x844 and 390x440. |
| AP-17 컨트롤을 설명하는 문장 | 위반 → 고침 | The button already said Continue without a file, so removed the duplicate sentence above it after confirming there were no aria-describedby references. |
| AP-18 아이콘이면 끝나는 문장 | 위반 → 고침 | The toggle repeated `다운로드 범위` (download scope) three times; removed the label and gave the icon an accessible name. |
| AP-19 위젯이 이미 말한 것 | 위반 → 고침 | Removed `하나` (one) from radio options, leaving `마일스톤`/`팀` (milestone/team). |
| AP-20 묻지 않은 질문 | 위반 → 티켓 이관 | Rather than deleting the screen showing What changed?, raised a separate ticket for the owner to decide whether it should remain. |
| AP-21 좁은 화면에서 본문과 메타가 부딪힘 | 위반 → 고침 | At 390x844 the body broke beside the name; grouped author+badge+time in the header and moved the body below. Kept wide-screen inline layout. |
| AP-22 같은 질문을 다른 말로 다시 지은 확인창 | 위반 → 고침 | Matched the repository-URL cancel question and stay/discard branches to the existing dialog while retaining its specific explanation of the URL to be discarded. |
| AP-23 현재 값과 변경 결과가 모호한 컨트롤 | 위반 → 고침 | Distinguished committed `허용됨` (granted) from proposed `회수` (revoke), aligned accessible names, and updated only after server success. Pending/failure appear in place. |
| AP-24 품사가 섞인 선택지 | 위반 → 고침 | `허용됨` alone used a predicate among state nouns `없음`/`활성`/`비활성`; changed the vocabulary entry to `있음` and did not revert to action-like `허용`. |
```

## Do not do these things

- Do not replace the four judgment-based checks with automation: that makes a pass look like approval and removes the place where human review is needed.
- Do not label an unfixed violation “known”: if it is outside the ticket boundary, propose a separate ticket and record that fact.
- Do not treat this list as optional reference: a PR without all 24 rows fails the evidence gate.
- Do not move these checks into a repository helper module: if the skill depends on product code, deleting that code would delete the rule too.
- Do not try to automate C's eight checks: whether a button really does nothing requires reading its caller.
- Do not cover a finding with more prose: a new explanation usually signals a problem in the control or structure.
- Do not use this document's examples as a copy dictionary: they demonstrate judgment, and copied labels become antipatterns again on the next screen.
- Do not remove accessibility-linked sentences based on AP-17/AP-18: preserve `aria-describedby` connections even when removing the sentence visually.
- Do not change a shared label on just one screen: change all consumers together or raise a ticket.

## References

These are the sources for the items above.
To keep product decisions separate from external evidence, retain links only; do not copy source claims here without version context.
The descriptions and tables above identify which claims support each item.

**General principles**

- Nielsen Norman Group, [10 Usability Heuristics for User Interface Design](https://www.nngroup.com/articles/ten-usability-heuristics/) — basis for all of A, B, C, D, and E.
- Don Norman, [Signifiers, not affordances](https://jnd.org/signifiers-not-affordances/) — AP-9: something that does not work must not look as though it works.

**Controls and explanatory copy**

- NN/g, [Command Links](https://www.nngroup.com/articles/command-links/) — AP-5/AP-17: primary commands are buttons, not sentences.
- NN/g, [Concise, SCANNABLE, and Objective: How to Write for the Web](https://www.nngroup.com/articles/concise-scannable-and-objective-how-to-write-for-the-web/) — AP-17: the original measurement showing that concise copy improves usability.
- NN/g, [Icon Usability](https://www.nngroup.com/articles/icon-usability/) — AP-18: conditions for icon-only controls; keep visible text on primary CTAs and use icons alone only for repeated controls.
- W3C, [WAI-ARIA Authoring Practices — Button Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/) — AP-9: use `aria-pressed` only when the state actually changes.
- W3C, [WAI-ARIA Authoring Practices — Radio Group Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/radio/) — AP-19: a radio group allows one selection by definition.
- NN/g, [Listboxes vs. Dropdown Lists](https://www.nngroup.com/articles/listbox-dropdown/) — AP-24: option lists contain values named with nouns/adjectives; buttons carry commands/verbs.
- W3C, [WAI-ARIA Authoring Practices — Switch Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/switch/) — AP-23: a switch's label does not change with its state; this does not mean every binary value must be a switch.

**Structure and flow**

- GOV.UK Design System, [Question pages](https://design-system.service.gov.uk/patterns/question-pages/) — AP-14: ask one thing at a time, and do not request the same information twice within one journey.
- NN/g, [Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/) — AP-13: criteria for what to collapse and what to show.
- NN/g, [Wizards](https://www.nngroup.com/articles/wizards/) — wizards suit infrequent work; do not make repeated editing into a wizard.
- NN/g, [Proximity Principle in Visual Design](https://www.nngroup.com/articles/gestalt-proximity/) — AP-21: when content collides with metadata on narrow screens, it reads as part of that metadata; inline layout itself is not prohibited.
- NN/g, [Toggle-Switch Guidelines](https://www.nngroup.com/articles/toggle-switch-guidelines/) — AP-23: switches usually imply immediate application; consequential changes may use status text plus an explicit action button.

**Errors and undo**

- NN/g, [Confirmation Dialogs Can Prevent User Errors](https://www.nngroup.com/articles/confirmation-dialog/) — AP-15: confirmations must explain consequences and reversibility.
- NN/g, [Error Message Guidelines](https://www.nngroup.com/articles/error-message-guidelines/) — errors explain both the cause and the next action.
- W3C, [WCAG 2.2 — 3.3.4 Error Prevention](https://www.w3.org/WAI/WCAG22/Understanding/error-prevention-legal-financial-data.html) — AP-15: irreversible submissions offer review, confirmation, or cancellation.

**Accessibility and responsiveness**

- W3C, [WCAG 2.2 — 2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) — AP-16: minimum action-target size for repeated icons.
- W3C, [WCAG 2.2 — 1.4.10 Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) — AP-16: narrow screens must not lose content or force scrolling in both directions.
