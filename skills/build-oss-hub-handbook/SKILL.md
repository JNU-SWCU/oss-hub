---
name: build-oss-hub-handbook
description: Create or refresh evidence-based OSS Hub user handbooks in Notion for students, staff, or administrators. Use when asked to write, update, verify, restructure, or add current screenshots to OSS Hub manuals, guides, onboarding docs, or demo instructions. This skill documents observed behavior and reports product gaps; it never modifies OSS Hub product code or silently changes product policy.
---

# Build OSS Hub Handbook

Produce a role-specific handbook whose labels, steps, screenshots, and release footer match the current OSS Hub service. Prefer a precise `확인 필요` marker over an inferred instruction.

## Guardrails

- Modify handbook content only. Do not edit OSS Hub product code, database records, accounts, program data, repository settings, or deployment state.
- Do not work around a product defect while writing the handbook. Record it in the final problem report instead.
- Do not open a ticket, send mail, upload a submission, or perform another product-side write unless the user separately authorizes that action outside this skill.
- Never put credentials, test-account passwords, tokens, private email addresses, student identifiers, or unredacted production screenshots in a handbook or public repository.
- Treat program ownership, staff access scope, repository ownership proof, retention, and email recipients as product-policy questions. Document the current observed behavior and label unresolved policy `정책 확인 필요`.

## Workflow

### 1. Fix the documentation baseline

Collect:

1. target role and reader level;
2. current production release and verification date in KST;
3. existing handbook page, child pages, and demo script;
4. PM requests and any explicitly excluded scope;
5. available runtime evidence, such as the live UI, release notes, and completed QA records.

If the release or target page cannot be established, stop before publishing and ask for the missing location or mark the draft `확인 필요`.

### 2. Inventory tasks by role

Build the table of contents from tasks the role actually performs. Always include account settings:

- editable profile fields;
- fields that cannot be edited;
- notification email and opt-in behavior;
- account deactivation consequences and reactivation path.

For role-specific required coverage, read [quality-checklist.md](references/quality-checklist.md).

### 3. Verify labels and behavior

Use a Notion connector for semantic page reads and writes. Use the live browser only for UI labels, visible state, navigation, and screenshots that cannot be obtained semantically.

For every procedure:

1. confirm the starting role and page;
2. follow visible labels rather than guessed URLs;
3. record the success signal shown to the user;
4. distinguish implementation evidence from a live end-to-end observation;
5. mark the narrowest unverified step `확인 필요`.

Use these statuses consistently:

- `확인 완료`: observed on the stated deployed release;
- `확인 필요`: not exercised end to end or screenshot missing;
- `정책 확인 필요`: behavior exists, but intended scope or ownership is unresolved.

### 4. Capture safe screenshots

- Capture the current deployed screen, not a mockup, when possible.
- Show one decision or action per image and add a short caption.
- Replace visible example values in unsaved form state before capture, or crop/redact them without changing live data.
- Do not expose emails, GitHub test-account names, student IDs, real files, access tokens, or private repository details.
- Upload the image to Notion rather than relying on a short-lived signed URL.
- When a safe screenshot cannot be produced, keep the text instructions and add `확인 필요: 최신 화면 사진` at that exact location.

### 5. Write for first-time users

- Use Korean honorifics and the exact Korean labels shown in the UI.
- Start each chapter with what the screen is for.
- Use numbered actions and describe the visible completion signal.
- Put warnings immediately before the risky action.
- Separate automatic behavior from actions a person must trigger.
- Explain empty states, disabled buttons, and common recovery steps.
- Link related chapters instead of duplicating long procedures.

End every handbook page with:

`마지막 확인일: YYYY-MM-DD (KST) · 배포본 vX.Y.Z`

### 6. Update Notion safely

- Preserve useful existing child pages and images.
- Refresh stale labels, typos, release footers, and `확인 필요` markers before adding duplicate pages.
- Create a new page only when no suitable role handbook exists or the existing structure cannot be repaired cleanly.
- Keep credentials in their restricted source page; never copy them into the handbook.
- Fetch the page again after writing and verify its title, table of contents, child links, image captions, and footer.

### 7. Report product problems without fixing them

Return a separate report with one row per problem:

| Field | Required content |
| --- | --- |
| Area | Role and screen |
| Observed | Exact visible behavior |
| Expected | Handbook task that should be possible |
| Demo impact | Blocker, degraded, or cosmetic |
| Evidence | Release, time, and reproduction steps |
| Decision needed | Product or policy question, if any |

Do not describe a code change as completed. Recommend a follow-up owner or ticket only; create or implement it only after separate authorization.

## Completion gate

Before handoff, run every applicable item in [quality-checklist.md](references/quality-checklist.md). A handbook is complete only when:

- the role's core tasks are covered;
- account settings are covered;
- live evidence and unverified claims are distinguishable;
- screenshots contain no secrets or personal data;
- all page links resolve;
- every page has a current KST date and exact release;
- the separate product-problem report is included, even when it says `발견 없음`.
