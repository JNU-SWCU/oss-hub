---
name: write-github-comment
description: >-
  Open before posting or replying to OSS Hub PR/Issue comments, including requests
  to comment, reply, review, suggest, or leave an issue update, and before
  gh pr comment, gh issue comment, or gh pr review. Covers findings, replies,
  UX suggestions, and progress only. Screen discussions require element captures;
  replies do not repeat information already shown by widgets. PR bodies belong
  to submit-pr-evidence; ticket bodies belong to manage-qa-tickets.
metadata:
  version: "1.2.1"
---

# Write GitHub Comment

[한국어](SKILL.md) | **English**

English translation of the [Korean source](SKILL.md).
The Korean document remains authoritative.
This is a reading reference; runtime skill loading continues to use `SKILL.md`.

A comment supports a decision.
Communicate the judgment, reason, and next action that widgets do not already show.

## Output contract

Produce a draft file using one of the four templates.
Screen discussions include an element capture; replies omit what widgets already show; the draft passes public-safe `--text-only`.
Publish only after the user asks you to post.
If asked only for a draft, do not call `gh pr comment`, `gh issue comment`, or `gh pr review`.

## First choose the comment type

| Situation | Template | Capture |
| --- | --- | --- |
| A reviewer leaves a finding or recommends keeping the implementation | Finding (short form for keeping it) | Element capture required for a screen finding |
| An author responds to review feedback | Reply | After element capture if the fix changes a screen |
| Someone suggests a screen alternative on a PR or Issue | UX suggestion | Do not publish without a capture of the current component |
| Someone records progress, a PR link, or a blocker on an Issue | Progress | None |
| Writing the PR body itself | Use [`submit-pr-evidence`](../submit-pr-evidence/SKILL.en.md), not this skill | — |
| Writing a ticket body | Use [`manage-qa-tickets`](../manage-qa-tickets/SKILL.en.md), not this skill | — |

[`references/comment-templates.md`](references/comment-templates.en.md) owns the templates.
The following sections only explain when to use them and the core rules; fill-in body blocks belong in that file.

## Common principles

### Write what a green check hides, not what it already says

Do not repeat green CI checks, commit lists, or file lists in replies ([AP-19](../submit-pr-evidence/references/ux-antipatterns.en.md#ap-19-repeating-the-widgets-contract--heuristic-4-consistency-and-standards)).
A link connecting a finding to its fixing commit is nevertheless part of the answer.
Record executed suite/test counts only once, in the PR body's exact `## 검증` (Verification) section.
Follow [review reply principles](../submit-pr-evidence/SKILL.en.md#review-reply-principles) when updating that body after revalidation.

A reply states one of: fixed; retained with a reason; awaiting a decision — followed by the next action.
Do not hide checks that passed only after rerunning, unknown causes, deferred work, or pending approval.
Browser E2E is a local manual gate, so record its execution in the reply.
Always record unexecuted verification in the [body's `## 검증`](../submit-pr-evidence/SKILL.en.md#keep-local-environment-noise-out-of-the-body).
Remove disclaimers that merely repeat that a PR is open, but state decision-relevant limits, such as unverified deployment, once.

### Keep the reviewer's numbering

Renumbering a reply forces reviewers to count again to identify which finding it addresses.
Reuse their numbers to avoid that work.

### Each comment asks for one decision

Mixing two or more judgments makes it unclear which one needs a response.
Separate them into numbered items, each ending with fixed, not changed plus reason, or decision requested.

### Consider existing paths before new files

Before proposing simplification, read definitions, every caller, and tests; check whether changing or reusing the existing implementation solves it.
If duplicate code or a single-consumer split can be consolidated, identify both the boundary to remove and behavior to preserve.
File count is not the goal: preserve boundaries needed for migrations, tests, snapshots, authorization, error handling, and atomicity.
If the ticket forbids editing a path, request a scope-boundary decision first; do not demand consolidation before approval.

### Show the screen when discussing it

Explaining an awkward area only in text makes the reader reopen the screen and find it.
Attach a component-level capture with selector, URL, and viewport captions to frontend findings and suggestions.
[`manage-qa-tickets/agents/qa-dom-capture.md`](../manage-qa-tickets/agents/qa-dom-capture.md) owns capture procedure; open authenticated screens through the harness in [`submit-pr-evidence/references/evidence-harness.md`](../submit-pr-evidence/references/evidence-harness.en.md).
Follow [`submit-pr-evidence/references/frontend-capture.md`](../submit-pr-evidence/references/frontend-capture.en.md#upload-assets-to-an-already-published-release) for upload (release asset `--clobber`); never use `gh release create`.

### Frame suggestions as a comparison with the current state

After the conclusion and decision request, show the current capture and explain current/proposed/reason (AP number or user cost).
An alternative mockup is optional; label it a sketch if included.
The current capture is evidence; a proposed drawing is not.

### Out-of-scope suggestions become tickets, not lingering comments

Comments are forgotten; tickets remain.
End with one line saying the work is outside this PR and will become a ticket, then hand it to [`manage-qa-tickets`](../manage-qa-tickets/SKILL.en.md).

### Keep the author's voice

Use the author's own casual or formal tone.
Do not polish it into generic agent wording such as “has been completed” or “has been verified”; that erases the author's voice.
Length is not evidence of diligence: if three lines suffice, stop at three.

### Follow the readability format

[readability.md](../submit-pr-evidence/references/readability.en.md) is the sole source of readability rules; do not copy them here.

### This is a public surface

Do not include real names, personal information, real data, or local paths.
Refer to people only by `@handle`.
Always check before publishing.

```bash
ISSUE_TEXT="$(cat <draft>)" bash scripts/check-public-safe.sh --text-only
```

## Procedure

1. Choose the comment type from the [table above](#first-choose-the-comment-type).
2. For a reply, reread findings by number; a reply with an unanswered number is incomplete.
3. For a screen discussion, first capture the element, add its selector caption, upload the release asset, and confirm HTTP 200 using `curl -sIL … -w "%{http_code}"`.
4. Write a draft file outside the repository (scratchpad), with the applicable template open while filling it in.
5. Perform a deletion pass: remove widget repetition and decorative diagrams, while preserving proposal conditions, required evidence, and verification limits.
6. Pass the readability self-check and public-safe `--text-only` using the final draft.
7. Publish only after the user asks: `gh pr comment <n> --body-file <draft>` / `gh issue comment <n> --body-file <draft>` / `gh pr review <n> --comment --body-file <draft>`. Do not use inline `--body "…"`. Stop at the draft if that is all the user requested.
8. Reopen the published comment in a browser or with `gh … --comments` and confirm images render. A broken image is a missing image.

## Do not

- Put CI/test counts/lint success in replies; they belong in the body's `## 검증` section.
- Describe a screen only in text; use an element capture.
- Capture the entire screen and explain its location in a caption; choose the selector and capture that element.
- Answer ten findings in one paragraph; answer by number.
- Suggest without asking for a decision; show the next action in the first screenful.
- Accumulate out-of-scope suggestions in comments; create tickets through the appropriate workflow.
- Post directly with `--body "…"`; use a checked draft file.
- Publish a comment when only a draft was requested; obtain publication authorization.
- Use real names, including honorific forms; use `@handle`.

## Completion checklist

- [ ] Selected the appropriate template and removed unnecessary optional fields.
- [ ] Provided one answer for every reviewer-assigned number when replying.
- [ ] Included element captures for screen discussions, with selector/URL/viewport captions.
- [ ] Removed statements already conveyed by widgets.
- [ ] Preserved proposal conditions, required boundaries, and evidence.
- [ ] Passed public-safe `--text-only` on the draft file.
- [ ] Published only with authorization; otherwise stopped at the draft.
- [ ] Reopened the published comment and checked image rendering.
- [ ] Passed the [readability.md](../submit-pr-evidence/references/readability.en.md) self-check.
