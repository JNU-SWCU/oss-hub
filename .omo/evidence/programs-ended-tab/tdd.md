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
