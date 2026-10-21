# Comment Templates

[한국어](comment-templates.md) | **English**

English translation of the [Korean source](comment-templates.md).
The Korean document remains authoritative.

There are four templates.
`<…>` marks a field to fill; remove parenthesized conditional lines when inapplicable.
First consult the table in [SKILL.md](../SKILL.en.md#first-choose-the-comment-type) to choose a template.

## Finding (reviewer → author)

```markdown
**<number>. <one-line conclusion> — <blocker / non-blocking suggestion>**
Next: <one requested change or decision question>

<Why this matters: one sentence about user cost; for UX, AP-<n> name>
Suggestion: <how to change the existing implementation>
Conditions: <approval/scope constraints and behavior to preserve> (delete if none)

Evidence: [<what this proves>](<exact-head blob link>)

<img width="<w>" alt="<one sentence describing the capture>" src="<release asset URL>">
<sub>`<selector>` · `<URL path>` · <viewport> · <HEAD sha or deployment></sub>

Verification criterion: <behavior to check after the change> (delete if no change requested)
```

- Attach an element capture to screen findings. Comments only about code structure use inspected code links and do not claim screen verification.
- Attach a high-level flow diagram when proposing changes to backend branches, state transitions, call order, or layering boundaries ([format](../../submit-pr-evidence/references/backend-diagram.en.md)). Do not draw diagrams for behavior-preserving file moves or recommendations to keep the current implementation.
- Use subheadings such as “Behavior to preserve” or “Decision evidence” only for complex conditional suggestions. Place long supporting detail in a bottom `<details>` block, but do not collapse approval conditions or safety boundaries.
- End recommendations to retain the implementation as below. Finding no additional issue does not resolve existing open threads.

```markdown
I recommend keeping the current implementation. No new blocker.
Next: <keep this scope / decision needed in the existing thread>. No additional changes requested.
<One sentence explaining why the existing implementation is sufficient>
Evidence: [<existing path>](<exact-head link>) · [<preservation check>](<exact-head link>)
```

## Reply (author → reviewer)

```markdown
<number>. Fixed — <how, one line> (<7-character commit>)
<number>. Not changed — <one-line reason>
<number>. Decision needed — <option A / B and the cost of each, one line>

Next: <reviewer's action: review again / decide / ready to merge>

<After element capture here if applicable: same img+sub format as the finding template>

What green checks do not show: <check that passed on rerun / local E2E execution / deferred item> (delete if none)
```

- Keep the reviewer's numbering; renumbering makes them count again to identify the addressed finding.
- The informal tone above is only an example; use the author's actual voice.
- The skill's [“Write what a green check hides, not what it already says”](../SKILL.en.md#write-what-a-green-check-hides-not-what-it-already-says) section owns the distinction between that explanation and the PR body's exact `## 검증` (Verification) section.

## UX suggestion (anyone → owner)

```markdown
**<one-line proposed change> — <blocker / non-blocking suggestion>**
Decision needed: <one question for the owner>

<img width="<w>" alt="<what the current component shows>" src="<release asset URL>">
<sub>`<selector>` · `<URL path>` · <viewport> · <sha/deployment></sub>

Now: <what this component currently says/does, one or two lines>
Proposed: <specific alternative wording/control/state>
Why: <AP-<n> or one sentence about user cost>
Boundary: <within this PR / ticket, choose one>
```

- Do not publish without a current-state capture. If capture is impossible, report why to the user and stop instead of posting the comment.
- If an alternative sketch exists, attach it as the second image and put “Proposed sketch” in its alt text to distinguish it from the current capture (evidence).
- Use the finding template above for backend suggestions without a screen.

## Progress (Issue)

```markdown
PR: #<number> (<state: open / in review / merged>)
Remaining: <one line or bullets>
Blocked: <what, whose decision is needed> (delete if none)
Next: <assignee's action / no further action>
```

- This template does not cover the Issue's body/contract; `manage-qa-tickets` owns that.
