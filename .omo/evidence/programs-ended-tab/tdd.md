# Programs ended tab TDD

## MUST #2 — optional ended-years

- RED: `pnpm --filter frontend exec vitest run src/features/programs/catalog/program-list-page.test.tsx`
  exited 1: 5 failed, 16 passed. A 404 removed the card; search/page/sort each fetched
  years twice instead of once; URL year 2030 displayed an empty selection.
- Implementation: independent abortable years effect, separate from list load state;
  required API signal; preserve the valid URL year in the options.
- GREEN: the same page test plus `program-api-contracts.test.ts` exited 0:
  2 files, 45 tests passed. LSP reported no errors on the list component.
- E2E regression: ended-years 404 must retain two cards and hide the year selector.

## SHOULD #4 — detail-only project boundary

- Before removal: moved all 12 malformed-field cases to `parseProjectDetail`.
  Targeted Vitest exited 0: projects 28 tests, list page 21 tests passed.
- RED: not applicable to behavior-preserving removal; tests were green first.
- Removed list/year API helpers, their test-only parsers/types, and list labels.
- GREEN: projects 24 tests passed after removal; `pnpm lint:structure` exited 0,
  no unused code found (5 existing configuration hints).

## SHOULD #5 — programs page wrapper

- Before: `src/app/programs/page.test.tsx` passed 2 tests.
- RED: not applicable to behavior-preserving wrapper removal.
- Restored the client page directly and pointed the existing capability tests at it.
- GREEN: page capability tests passed 2/2 after removal; LSP found no errors.

## SHOULD #10 — current sidebar count

- RED: sidebar-menu tests exited 1: 1 failed, 66 passed. With only all=9 and
  ended=3, the current count was 0 instead of 6.
- Changed the count to all minus ended.
- GREEN: the same sidebar suite exited 0, all 67 tests passed.
- Full-src follow-up exposed one stale collapsed-label expectation: fixture all=15,
  ended=9 now correctly renders 6, not the sum of the incomplete status fixture (3).
  Updated that existing assertion; initial full run: 4173 passed, 1 failed.
- Follow-up GREEN: sidebar and collapsed sidebar suites passed 79/79.

## Removed archive routes

- Inspection: no archive route files remain; next.config.ts has no redirects.
- Added browser assertions for `/archive` and `/archive/public-project`: HTTP 404,
  no redirect chain, unchanged URL. Included in the single requested e2e run.

## Verification

- Final `CI=1 pnpm --filter frontend exec vitest run src --reporter=dot`:
  381 files passed, 4174 tests passed, exit 0.
- Frontend typecheck, lint (0 errors, 4 existing anchor warnings),
  `pnpm lint:structure` (no issues, 5 existing configuration hints), and
  `CI=1 pnpm exec prettier --check .` passed.
- Requested 7-spec e2e run: 42 passed, 2 failed. Only program-list-sort lacked
  mocks for the frontend-only current contract, so the old backend returned 400.
  Added test-only current/ended-years route mocks, preserving backend sort order.
  Final targeted rerun: 2 passed, exit 0. No product fallback was added.
- Programs-ended passed all 11 scenarios, including ended-years 404 and both
  removed archive URLs returning 404 without redirects.
- Full formatting must run after e2e cleanup: temporary backend compiled outputs
  are not excluded by the current formatter ignore list. They are removed by the
  existing run-stack cleanup; no formatter configuration changes were needed.
- Before: actual production v0.23.8; After: this branch with public program data
  replayed through route mocks. Eight PNGs uploaded to the existing v0.23.8 release
  with the PR-programs-ended-v2 prefix. No images committed.
- Production gate checked on 2026-10-30: status=current 400, ended-years 404.
  PR A #1611 must deploy first; both endpoints must return 200 before merge.
