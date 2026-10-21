# UX Reference Catalog

[한국어](ux-reference-catalog.md) | **English**

English translation of the [Korean source](ux-reference-catalog.md).
The Korean document remains authoritative.

This document owns product references repeatedly cited in OSS Hub QA tickets' `참고 UI` (Reference UI) sections.
Individual tickets link here instead of restating its URLs and boundaries.
The UX-improvement section of [SKILL.md](../SKILL.en.md) owns candidate-search scope, aspect-scoped approval, and handling rejected candidates.

## Primary reference — daker.ai

| Item | Value |
| --- | --- |
| Product root | `https://daker.ai/` |
| Inspiration source | `https://daker.ai/public/hackathons` |
| Representative detail screen | `https://daker.ai/public/hackathons/<competition-slug>` |
| Relationship | OSS Hub's public program list and detail pages were inspired by this screen structure |

### What to borrow

Borrow how the public detail screen controls information density.
Collapse long descriptions into sections while keeping actions participants actually need near the top.
Titles and icons should reveal what a section contains even while collapsed.
Give each section an anchor for direct navigation from the contents list.

### What not to borrow

Do not borrow branding, copy, colors, or typography.
OSS Hub's design tokens and component contracts remain authoritative.
Features without corresponding OSS Hub concepts, such as rankings, leaderboards, or prize displays, are outside the reference scope.
Do not copy daker.ai's routing structure or URL shape.

### Capture handling

Do not put unauthorized third-party product captures in public Issues.
Public surfaces contain only descriptions of patterns and public URLs.
Crop OSS Hub's own screens by selector for tickets.
If a capture contains real user names, emails, or team names, discard it and obtain a replacement.

## Adding references

Add a product to this catalog only when it is likely to be cited in at least two tickets.
Keep one-off references in the individual ticket's `참고 UI` section instead.
Use the same table format above and fill in the product root, inspiration source, what to borrow, what not to borrow, and capture handling.
If either borrowing boundary is empty, the reference has no defined scope; do not add it.
