# How to Produce Actual Evidence

[한국어](evidence-harness.md) | **English**

English translation of the [Korean source](evidence-harness.md).
The Korean document remains authoritative.

Merely saying “take a capture” leaves people figuring it out again each time.
This document describes the paths that produce screen evidence in this repository and the places where the process can silently go wrong.
[frontend-capture.md](frontend-capture.en.md) is authoritative for publication, public safety, and filename rules.

## Keep the two execution paths separate

| Purpose | Path | Do not use |
| --- | --- | --- |
| Everyday checks and manual Before/After | `pnpm dev` connected to the real backend, synthetic role accounts, and the browser tool chosen by the user | A review server without a backend, a new preview port, an emulator catalog, or replacing the specified tool with another one |
| Automated browser regression | Existing `pnpm --filter frontend e2e` (fresh stack, Chrome, workers 1, retries 0) | Treating a passing suite alone as a replacement for PR screen attachments, or starting a new capture-only server |

A passing E2E run is regression evidence, not an image attachment.
If that run produced Before/After files satisfying [frontend-capture.md](frontend-capture.en.md), reuse those files as PR evidence.

When manual checks apply, use the browser tool explicitly specified by the user.
If none is specified, follow the installed craft `browser` routing; do not freeze its default in this document.

Use the following only when Aside was selected.

```bash
aside "Open http://localhost:3000/<path> and inspect the changed control with the synthetic staff actor"
aside repl "const p = await openTab('http://localhost:3000/<path>')"
```

`aside repl` is the documented surface for deterministic checks, screenshots, and downloads.
Do not invent subcommands or REPL APIs absent from the installed Aside version.
If versions differ, consult the [Aside developer documentation](https://docs.aside.com/help/developers); when uncertain, stop rather than guess.

Automated regression uses an entry point already present in the repository.

```bash
pnpm --filter frontend e2e
```

This command starts isolated PostgreSQL and the real backend.
Responses intercepted only at the UI prove layout and error copy, not persistence, authorization, or transactions.
Do not add a new preview server.

Follow the `AUTH_INITIAL_ROLES` procedure in [README](../../../README.en.md) for synthetic role accounts.
Do not put real names, real data, or personal machine paths in screens or filenames.

## Obtain Before / After under matching conditions

Capture Before from an `origin/main` worktree and After from the working worktree.
Two `pnpm dev` processes cannot use host ingress 3000 simultaneously, so start and stop them sequentially.
Match the URL, synthetic role, viewport, locale, timezone, and synthetic data.

`apps/frontend/playwright.config.ts` does not set a global `timezoneId` or fixed clock.
For screens involving time or deadlines, the test specifies the clock explicitly.
Examples include `test.use({ timezoneId: 'Asia/Seoul' })` or `'UTC'`, `page.clock.setFixedTime(...)`, and `now` in the program-authoring reset.
`E2E_FROZEN_NOW` and `TZ=Asia/Seoul` in `e2e/run-stack.sh` are stack-process environment settings, not a global browser clock.
A fixed clock and fixed calendar dates are valid; do not require a relative-offset builder.

Use filenames in the form `<이슈번호 또는 티켓없음-슬러그>-<before|after>-<element|desktop|mobile>-<무엇>.png`: the Korean placeholders mean issue number or no-ticket slug, and the captured subject.
Release assets share a repository-wide namespace, so without the leading token they overwrite one another.

### When an element capture is blank

- The scroll container may not be `main`.
  Some screens in this repository have no `main` tag at all.
  Anchoring on text and capturing an ancestor element is more reliable.
- Content opened through a portal (dialog), such as a resubmission form, does not appear in `main.innerText`.
  Target the `form` directly.
- A role locator returns zero matches when the accessible name differs from the visible text.
  Find the button by its visible text.

In automated regression, several buttons may have the same name and the first may be disabled.
Choose one that can be clicked.

```js
const all = page.locator('button:has-text("수정")');
for (let i = 0; i < await all.count(); i++) {
  const b = all.nth(i);
  if (await b.isDisabled()) continue;
  await b.scrollIntoViewIfNeeded(); await b.click(); break;
}
```

The selector's Korean text `수정` means “Edit” and must match the actual interface.

## A state that cannot be produced cannot be captured — block submission when applicable

A state nobody can inspect visually silently becomes stale.
Create the required state using a small synthetic input within the test, an existing seeded role, or a UI-only `page.route` that interrupts just that request.
Do not expand an emulator persona catalog.

Layout, empty states, and error copy can be demonstrated with precise test-owned responses.
Persistence, authorization, transactions, and the deployed wire contract require separate real-backend evidence.
Do not use an intercepted screen capture as proof that the server is correct.

If an applicable screen cannot be produced with synthetic data or scoped UI inputs, the capture does not exist.
Do not open the PR with an exemption explanation in its body.

## Actually produce empty and error states

When an empty screen has multiple branches, actually check that each branch shows different copy.
Taking three captures with the same data produces three identical images.

- “아직 없음” (“nothing yet”) — use a synthetic target that genuinely has zero records.
- “조건에 맞는 것 없음” (“no matches”) — start with a synthetic target containing data, then use search or filters to produce zero matches.
- “불러오지 못함” (“could not load”) — interrupt only that request in automated regression: `page.route('**/…**', r => r.abort('failed'))`.
  When Aside is selected, do not invent network APIs it does not provide.

## False positives in the four automated checks

The console snippets in `ux-antipatterns.md` count DOM nodes, so they flag responsive navigation rendered twice or a calendar's period labels repeated for each week row as duplicates.

In hidden tabs, `offsetParent` and `getBoundingClientRect` values can all be zero, breaking visibility detection.
Checking computed styles instead of layout also works in hidden tabs.

```js
const hidden = (el) => { let n = el;
  while (n && n.nodeType === 1) { const s = getComputedStyle(n);
    if (s.display === 'none' || s.visibility === 'hidden') return true; n = n.parentElement; }
  return false; };
```

Do not record every match as a “violation.”
Distinguish **stating the same fact twice on a summary surface** from **structural repetition**, such as one section heading per milestone or a calendar label for a period spanning multiple weeks.
Include a piece of observed evidence in the verdict table explaining the decision; a row that says only “pass” is an unsupported pass.

## Write the PR body to a file

If a body contains backticks and you use an unquoted shell heredoc, the shell executes the enclosed text as a command and leaves that position empty.
A body has actually been published with `deletionProtected` and `allow={['staff']}` missing entirely.

```bash
cat > /tmp/pr.md <<'MDEOF'      # 따옴표가 핵심이다
… 본문 …
MDEOF
gh pr create --body-file /tmp/pr.md
```

The Korean comment emphasizes that the quotes are essential; `… 본문 …` is the placeholder for the body.
Leave placeholders where values such as URLs must be inserted, then replace them with `sed`.
After publication, reread the body with `gh pr view <번호> --json body` (`<번호>` means the PR number) and check that nothing is missing.
