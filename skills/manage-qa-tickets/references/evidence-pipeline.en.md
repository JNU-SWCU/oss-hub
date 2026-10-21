# Evidence Collection Pipeline

[한국어](evidence-pipeline.md) | **English**

English translation of the [Korean source](evidence-pipeline.md).
The Korean document remains authoritative.

Three evidence streams are needed before writing a ticket body; they do not exchange inputs.
Run them concurrently as subagent lanes rather than sequentially.
All lanes are read-only; only the orchestrator writes the body and publishes the Issue.

## Lane setup

| Lane | Responsible agent | Output |
| --- | --- | --- |
| Capture | [`qa-dom-capture`](../agents/qa-dom-capture.md) | Path to an element-only image, selector, DOM path, full URL, verification time |
| Code anchor | [`qa-code-anchor`](../agents/qa-code-anchor.md) | Starting point as `path:line`, current section order, data actually received by the component, related tests |
| Duplicates | Orchestrator | Related Issue numbers/titles and evidence supporting the duplicate judgment |

The orchestrator searches symptoms, paths, and roles directly with `gh issue list --search`.
The other two lanes are read-only and do not consume one another's output, so launch them concurrently.

Launch only one capture lane.
There is one browser: two lanes claiming the same tab overwrite each other's screens.
Process captures sequentially within that lane.

Do not launch a capture lane for `backend` or `infra` areas.
The area-specific evidence table in [issue-ticket-contract.md](issue-ticket-contract.en.md) defines their minimum evidence.
A `backend` logic change needs a flow diagram at PR submission instead of a screen capture; [submit-pr-evidence/references/backend-diagram.md](../../submit-pr-evidence/references/backend-diagram.en.md) owns that requirement.

## What to give a lane

Give each lane a confirmed target, not a judgment to make.
Provide the capture lane with both a URL and a CSS selector.
The orchestrator chooses the selector; do not leave the lane to pick one from the screen.

Receive structured data, not prose, from lanes.
The capture lane reports failed items as `{"error": ...}` and continues with the rest.
One failed capture must not stop the entire lane.

## Capture-lane procedure

1. Navigate to the URL and wait for hydration.
2. Locate the selector, scroll it into view, and read its rectangle with `getBoundingClientRect()`.
3. Crop only that rectangle plus a small margin and save it to a file.
4. Inspect the saved image directly to confirm it contains the intended element. Adjust and recapture if it does not.
5. If the element is absent, report that rather than guessing.

Capture each state separately for stateful elements such as collapsibles or tabs.
Do not try to explain both collapsed and expanded reference UI with one image.

Before saving, read the element text for real names, email addresses, or team names.
If any appear, do not save; report the finding.

## Fact-check before publication

Once the body draft is complete, give it to [`qa-fact-checker`](../agents/qa-fact-checker.md) for pre-publication verification.
The drafting lane must not validate its own draft.
Verify claims rather than wording: whether assumptions still hold, reproduction steps actually reproduce, `path:line` contains the stated content, the issue is already fixed or ticketed, and a component proposed for reuse actually exists.
Do not publish while any `REFUTED` claim remains uncorrected.
Keep `UNVERIFIED` items in the body as `확인 필요` (verification required), without presenting them as confirmed.

## After the orchestrator receives the results

Lane reports are claims, not evidence.
Do not move an item into the ticket without a verifiable file path, `path:line`, row ID, or equivalent; leave it `확인 필요`.
Write the body after all three lanes return, then pass public-safety checks before publishing the Issue.
