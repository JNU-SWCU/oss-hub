# Task 2 browser and test evidence

- Scope: staff insights comparison UX; synthetic fixture data only.
- Baseline: `pnpm --filter frontend test -- src/features/staff-insights/staff-insights-view.test.tsx` passed (2 tests, 2936 suite tests observed).
- Failing-first proof: after adding the regression assertions and before production edits, the focused test failed because `비교 관점` and `활동률` were absent.
- Passing focused test: `pnpm --filter frontend exec vitest run src/features/staff-insights/staff-insights-view.test.tsx` (3 passed).
- Typecheck: `pnpm --filter frontend typecheck` passed.
- Lint: `pnpm --filter frontend lint` completed with 0 errors and 5 pre-existing warnings in `src/app/_shell/sidebar-drawer.test.tsx`.
- Browser QA: not run in this environment; no screenshot artifacts are claimed.
- Notes: comparison controls now have separate `기간` and `비교 관점` groups; rate copy preserves numerator/denominator and zero-denominator handling; unregistered disclosure is explicit; participation bars are not stacked; chart identity is not color-only; existing backend semantics and accessible tables remain unchanged.
