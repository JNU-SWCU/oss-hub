# Publish Frontend Before/After Captures in the PR

[한국어](frontend-capture.md) | **English**

English translation of the [Korean source](frontend-capture.md).
The Korean document remains authoritative.

Saying “attached” is not enough: putting a local path such as `/tmp/before.png` in the PR body renders no image, leaving the reviewer to approve without seeing the screen.
This section therefore establishes a path that actually renders images.

## Capture under matching conditions

Capture Before from the code before the change and After from the code after the change.
Match the remaining conditions: synthetic role, viewport, and synthetic data state affecting the behavior being compared.
Include the source SHA, route, viewport, and synthetic state in the caption.
If isolated origins differ, disclose the difference; do not claim that the full URLs match or that this was a fresh run.
Disclose differences in data outside the comparison scope or in browser profiles that cannot be observed; do not claim those areas match as well.

Actual Before/After images and full-screen After images at desktop and 390x844 must render as public attachments.
There is no general screenshot exemption.
If the applicable captures cannot be produced, stop submission instead of replacing them with N/A or `Before/After 없음` (“no Before/After”).
Mockups, Figma designs, test output, and code diffs cannot replace actual running screens or real browser/API behavior.

[SKILL.md](../SKILL.en.md#screens-browsers-and-consuming-screens--captures) is authoritative for applicability branches and section declarations.
The table skeleton is the `## Before / After` section of the [PR template](../../../docs/translations/pull-request-template.en.md).
[`evidence-harness.md`](evidence-harness.en.md) is authoritative for the execution path that produces Before/After under matching conditions.

### Visual/component changes — `| 요소 |`

The fixed table marker `| 요소 |` means “element”; retain its Korean spelling for the checker.
Capture only the area needed to identify the changed component.
Do not capture the entire screen and explain the target only in a caption.

**The `| 요소 |` rows come first and are mandatory**: create one table row for each changed component.
Before and After must use the same selector.
If the ticket specifies a `현재 화면` (“current screen”) selector, reuse that selector exactly instead of choosing a new one.
If the selector itself changed, for example because an element moved to a different container, the same selector cannot be used: include both the Before and After selectors in the caption.
The DOM path change itself is information the reviewer needs.

**Place the two full-screen captures as links below the table, not inside it**: full-screen images inside the table bury the element rows.
The authoritative procedure for element captures, including selector selection and reading the bounding rect and DOM path, is manage-qa-tickets' `qa-dom-capture`.

### Nonvisual browser changes — `| 동작 |`

The fixed table marker `| 동작 |` means “behavior”; retain its Korean spelling for the checker.
For browser-routing or runtime-boundary changes that leave rendered components unchanged, do not invent `| 요소 |` rows.
Open `## Before / After` with `비시각 브라우저 변경 — <비어 있지 않은 이유>` (“nonvisual browser change — <nonempty reason>”), retaining the Korean declaration and replacing the placeholder with the reason.
That line is not an exemption.
Include a `| 동작 |` table in the section, together with actual Before/After full-screen captures and evidence of actual browser/API behavior.

Follow the same filename convention as [`run-release-qa`](../../run-release-qa/SKILL.en.md): `qa-id-role-route-viewport.png`.
Diverging capture filename conventions within the same repository make it difficult to trace which QA run produced an artifact.
For a PR without a ticket, use a no-ticket slug in place of the issue number.

## Manually inspect public safety before uploading

Open the two saved images and visually inspect them for anything prohibited from public disclosure by the [public-safety checker](../../../scripts/check-public-safe.sh).
Do not copy that deny-list here: copies silently diverge when the original changes.
If anything prohibited is visible, do not upload; capture again with synthetic data.
Capture without session tokens, cookie values, devtools panels, or authentication-related query parameters visible on screen.
Image metadata, such as device, path, or location information in EXIF, is invisible on screen but remains in the file; remove it before uploading or save the image again in a way that retains no metadata.
`scripts/check-public-safe.sh` does not inspect these images: it scans repository text, while evidence images live outside the repository.
This is therefore a manual verification gate without automation.

## Upload assets to an already published Release

```bash
TAG=$(gh release list --exclude-drafts --exclude-pre-releases --limit 100 \
  --json tagName --jq 'map(select(.tagName | test("^v(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$"))) | .[0].tagName // empty')
if [[ -z "$TAG" ]]; then
  printf '%s\n' '이미 발행된 정식 SemVer Release를 찾지 못했습니다. 업로드를 중단합니다.' >&2
  exit 1
fi
gh release upload "$TAG" 1181-before-element-archive-dialog.png ... --clobber
```

The Korean error message means “No already published stable SemVer Release was found. Stopping the upload.”
Select the first Release among the latest 100 whose tag follows `vMAJOR.MINOR.PATCH`, excluding drafts and prereleases.
If none exists, do not create a new Release or substitute a different tag.

The URL is fixed as `https://github.com/JNU-SWCU/oss-hub/releases/download/<태그>/<파일명>.png`, where the placeholders mean tag and filename.
Put it directly into the PR body as `![Before](…)` to render the image.
The process uses `gh` throughout and needs no manual intervention.

**This does not deploy production.**
The production deployment trigger is `release: types: [published]` (`.github/workflows/ci.yml`), and **adding files to a release that is already published does not emit that event**.
Only publishing a new release triggers it.
Continue to use only `gh release upload`, never `gh release create`.

Dragging images into a PR body through the browser (`user-attachments`) remains valid.
That method requires a browser session and cannot be performed with `gh`, so agent-created PRs use the release asset path above.

After uploading, check once that the URL actually returns 200: one typo creates a broken image in the body.

```bash
curl -sIL -o /dev/null -w "%{http_code}\n" "https://github.com/JNU-SWCU/oss-hub/releases/download/$TAG/<파일명>.png"
```

Then reopen the PR body and visually confirm that the image renders.
A bare file path does not count as uploading a capture.

Record capture conditions together on one `<sub>` caption line in the [PR template table](../../../docs/translations/pull-request-template.en.md); do not create a separate paragraph.

## Do not do these things

- Do not put a local path such as `/tmp/before.png` in the body and claim an attachment exists; no image renders.
- Do not commit evidence images to the product branch: binaries would enter the review diff.
- Do not create an evidence-only branch: that branch would have to be preserved forever to keep images in merged PR bodies from breaking.
  Creating an orphan branch in a separate worktree leaves that worktree without `package.json`, causing the `pre-push` `pnpm format:check` to fail and block the push.
- Do not publish a new release with `gh release create`: publication is the production deployment trigger ([Jenkinsfile](../../../Jenkinsfile)).
  **Adding files to an already published release with `gh release upload` does not emit that event and is safe; this is the method used in [Upload assets to an already published Release](#upload-assets-to-an-already-published-release).**
- Do not put evidence in `/artifacts/`: it is gitignored and reserved for raw per-student metrics.
  Uncommitted files do not acquire a URL.
- Do not substitute mockups, Figma designs, test output, or code diffs for actual running screens.
- Do not use `Before/After 없음` without obtaining applicable screen captures.
- Do not invent `| 요소 |` rows for components that were not rendered.
- Do not use `Before/After 없음` or N/A for nonvisual browser changes.
- Do not hide differences between isolated origins or claim that the complete URLs match or the execution is fresh.
