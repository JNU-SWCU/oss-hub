# Todo 8 ranking CSV completeness evidence

- Issue: #979
- Base: `97437068ac26e0ed55aab5b2f926de3d4ce7dcaf`
- Branch: `fix/ranking-csv-completeness`
- Setup: `bash scripts/setup-hooks.sh` (already active)
- Open PR inspection: only unrelated PR #977 was open.

## TDD

- Red: added the mismatch regression; targeted Vitest failed because `downloadTextFile` was called once for a short flattened result.
- Green: `ranking-screen.tsx` now flattens once and throws into the existing export error state unless `items.length === firstPage.total`.

## Verification

- Targeted test: 5 passed.
- Frontend test: 285 files, 2951 tests passed.
- Typecheck: passed.
- Lint: passed with 5 pre-existing Next link warnings in `sidebar-drawer.test.tsx`.
- Serial frontend build: passed with the same pre-existing warnings.
- Prettier: passed.
- Public-safe: passed.
- LSP diagnostics: no diagnostics in changed TS/TSX files.
- Chrome ranking export: 4 passed, including exact 205-row successful download and short-page mismatch with no download; readiness used Playwright assertions, no sleeps.

## Scope

Changed only ranking screen logic, its focused unit test, focused Chrome export coverage, and the required append-only team journal. No auth, backend, formula, schema, endpoint, lockfile, or production data changes.
