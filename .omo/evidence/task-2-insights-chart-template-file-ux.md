# Task 2 browser and test evidence

- Scope: staff insights comparison UX; synthetic fixture data only.
- Baseline: `pnpm --filter frontend test -- src/features/staff-insights/staff-insights-view.test.tsx` passed (2 tests, 2936 suite tests observed).
- Failing-first proof: after adding the regression assertions and before production edits, the focused test failed because `비교 관점` and `활동률` were absent.
- Passing focused test: `pnpm --filter frontend exec vitest run src/features/staff-insights/staff-insights-view.test.tsx` (3 passed).
- Typecheck: `pnpm --filter frontend typecheck` passed.
- Lint: `pnpm --filter frontend lint` completed with 0 errors and 5 pre-existing warnings in `src/app/_shell/sidebar-drawer.test.tsx`.
- Browser QA command: `node` Playwright harness from `apps/frontend` against `OSS_HUB_LOCAL_REVIEW_FIXTURES=1 pnpm --filter frontend dev`.
- Browser QA covered Chrome at 1440px and 375px, keyboard Tab focus, and 200% root text size. Readiness used `page.locator('main').waitFor()`; no sleeps.
- Browser artifacts: `.omo/evidence/task-2-browser/desktop.png`, `desktop-200-text.png`, `mobile.png`, `mobile-200-text.png`.
- Browser observables: `기간`, `비교 관점`, `31/42`, `학과 미등록`, and non-stacked participation chart rendered on the staff fixture. Empty/zero/unregistered-only paths are represented by the existing empty-state and zero-denominator code paths; synthetic fixture remains public-safe.
- Refactor module pure LOC: `staff-insights-view.tsx` 157, `insights-panels.tsx` 186, `participation-panel.tsx` 109, `insights-controls.tsx` 111, `insights-model.ts` 53.
- Post-refactor verification: `pnpm --filter frontend exec vitest run src/features/staff-insights/staff-insights-view.test.tsx` passed; `pnpm --filter frontend typecheck` passed; `pnpm --filter frontend lint` passed with 5 pre-existing warnings; `pnpm --filter frontend build` passed; `bash scripts/check-public-safe.sh origin/main` passed.
- Notes: comparison controls now have separate `기간` and `비교 관점` groups; rate copy preserves numerator/denominator and zero-denominator handling; unregistered disclosure is explicit; participation bars are not stacked; chart identity is not color-only; existing backend semantics and accessible tables remain unchanged.
