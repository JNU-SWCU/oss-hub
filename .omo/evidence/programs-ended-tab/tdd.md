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
