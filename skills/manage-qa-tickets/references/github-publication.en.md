# Publication Contract — Turn a Draft into a GitHub Issue

[한국어](github-publication.md) | **English**

English translation of the [Korean source](github-publication.md).
The Korean document remains authoritative.

A GitHub Issue is the sole canonical record for a QA/work ticket.
The drafting-stage file is the body to publish; do not mirror it to another store.
Publication means passing the draft through public-safety checks, creating it with `gh issue create`, then reading the resulting Issue back and reconciling it.

## Contents

- [When to publish](#when-to-publish)
- [Publish the draft unchanged](#publish-the-draft-unchanged)
- [Title, label, assignee, and deadline](#title-label-assignee-and-deadline)
- [Image admission criteria](#image-admission-criteria)
- [Pre-publication checks](#pre-publication-checks)
- [Create, then read back](#create-then-read-back)

## When to publish

Publish a verified draft immediately after drafting is complete.
When stage 1's duplicate recheck and fact-check pass, create the Issue without asking again.
A request to write a ticket is also a request to place that ticket on the execution surface.
Nobody can pick up an unpublished draft; postponing publication until another request usually means that request never arrives.

There are only three exceptions.

- The user asked to see only a draft. A draft request is not publication authorization.
- The user said not to publish this draft.
- The draft does not satisfy the conditions below.

Publish when the draft satisfies all of the following.

- The body defines required scope (`할 일` for functional defects, `최소 요구` for UX), completion criteria, and boundaries. Functional defects use `하지 않을 것 (이 티켓의 경계)`; UX uses the unchanged items in `작업 범위`.
- No open or closed Issue has the same title, path, symptom, and role. If one does, update or reference it instead of creating another.

An Issue can be published without an assignee.
An unassigned Issue is unclaimed work, not work prohibited from publication.

Automatic continuation to publication applies only to a draft just written in this conversation.
Editing an existing Issue is not automatic; edit only Issues the user identifies.

## Publish the draft unchanged

The Issue body copies the draft file stored outside the repository.
Preserve its opening, section order, headings, sentences, checkboxes, and lists; do not rewrite it during publication.
Rewriting splits the draft/publication contract, and the divergence surfaces only when reviewing the implemented ticket.

Place the repository [work-ticket template](../../../docs/translations/work-ticket.en.md)'s exact `## 시작` (Start) block at the beginning of the body.
It is the execution entry point and precedes the draft's problem statement.
The identifier is the GitHub-assigned Issue number.
Do not prefix the title with `QA<n>` or add `출처: QA<번호>` to the body.

For progress/blocker comments after publication, use the progress template in [write-github-comment](../../write-github-comment/SKILL.en.md), not this document.
If a PR uses `Closes` or `Refs` for the Issue, GitHub links it; do not duplicate the PR URL in an Issue comment.

Before publication, change only strings flagged by public-safety checks.
Correct them in the draft file, recheck the same file, and publish from it.
Editing only after creation would make the checked and published text differ.

Do not fill in missing facts during publication.
Missing file paths, API paths, or prerequisites mean stage 1 is unfinished, not that publication should invent them.
Complete the draft first, then publish that file.

Do not publish if any of the three execution contracts—scope, completion criteria, boundaries—is absent.
An empty boundary means not recorded, not no restrictions; a ticket without boundaries has no defined scope.

## Title, label, assignee, and deadline

Use the `<명령형 할 일>` (imperative task) title specified by [issue-ticket-contract.md](issue-ticket-contract.en.md).
Place a priority prefix such as `[P1]` before the imperative if used.
Put symptoms in the body's `문제` (Problem) section, not the title.

| Value | Issue |
| --- | --- |
| Title | `<명령형 할 일>`; the identifier is the Issue number after creation |
| Deadline | The `마감:` line under exact `## 우선순위와 기한`; one business day=`P0`, three=`P1`, five=`P2` |
| Work type | One body line `작업 유형: feat\|fix\|refactor\|chore`; there are no repository labels with those names |
| Persona | The body's `페르소나` line; do not create a separate label |
| Progress | Issue open/closed state and project board; do not create a separate state property |

The default label is the existing repository label `ticket`.
As recorded by `gh label list --repo JNU-SWCU/oss-hub` on 2026-09-23, repository labels were `bug`, `documentation`, `duplicate`, `enhancement`, `good first issue`, `help wanted`, `invalid`, `question`, `wontfix`, and `ticket`.
Do not create missing labels.
Add only semantically appropriate existing labels; if none fit, use only `ticket` and report it.

Assign zero or one GitHub `@handle`.
The user supplies the handle in conversation; put only that handle in `--assignee`.
Do not infer it from display names, emails, or accounts in other systems.
A wrongly assigned ticket silently sits on the wrong person's task list.
To assign someone else, the user must state in this conversation that the person consented.
Without that evidence, publish unassigned and report who should be assigned.
Self-assignment is always allowed.

## Image admission criteria

Include element captures of OSS Hub's own screens in Issues.
Showing the implementer what is wrong is half of a ticket, and our screens are surfaces we may publish.
Do not put unauthorized third-party product captures in public Issues.
Use only pattern descriptions and public URLs on public surfaces.
This does not forbid private observation evidence.

Even for our own screens, inspect the actual image before including it.

- Exclude captures containing real names, actual emails, student IDs, phone numbers, or real uploaded filenames.
- Exclude captures showing session tokens, cookies, developer tools, or authentication parameters in the address bar.
- Confirm that only the intended element is cropped; the element-capture contract also applies to publication.

If any condition fails, omit the capture and include only the reproduction path.
Omission is safer than masking and publishing.

`gh` has no image-upload API.
Paste images into GitHub's web editor and use the attachment URL GitHub returns in the body.
Do not commit images to the repository and reference raw URLs.
QA captures are not artifacts that belong in repository history.
If the browser path is unavailable, publish text only and report that the capture has not yet been attached.
Keep the selector, full URL, and verification-time caption with the image.
Do not leave a caption without its image.

## Pre-publication checks

Write the complete draft title and body to a temporary file outside the repository, and check that exact text.

```bash
ISSUE_TEXT="$(cat <draft-file>)" bash scripts/check-public-safe.sh --text-only
```

Do not check only a summary or excerpt.
A check guarantees nothing if the checked and published texts differ.
If it fails, correct the flagged strings in the draft file and recheck the same file.

CI also has a job checking Issue bodies, but they are already public by then.
The pre-publication check is the actual defense.

## Create, then read back

Create only from the checked draft file.
The body file consists of the template's exact `## 시작` block prepended to the draft.

```bash
gh issue create --repo JNU-SWCU/oss-hub \
  --title "<명령형 할 일>" \
  --body-file <body-file> \
  --label ticket \
  --assignee <github-handle>
```

Omit `--assignee` when unassigned, and repeat `--label` only for additional labels.
Read back the newly created number.

```bash
gh issue view <number> --repo JNU-SWCU/oss-hub --json title,body,labels,assignees,state,url
```

Confirm that the title, body sections, `ticket` label, assignee count, and body's `마감` line match the draft.
Compare the body's sections and sentences directly to the draft.
Publication finishes when the readback matches, not when the command is run.
If it differs, correct that Issue and read it again.
Do not create another Issue to cover the mismatch.
