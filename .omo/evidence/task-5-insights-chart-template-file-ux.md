# P4 lifecycle/purge validation

Date: 2026-08-21
Branch: `feat/program-lifecycle-purge-ux`
Issue: #960

## Scope review

The pre-existing dirty diff contains only lifecycle/purge UI, focused tests, and two extracted sibling modules:

- `apps/frontend/src/features/programs/program-edit-danger-zone-section.tsx`
- `apps/frontend/src/features/programs/program-edit-danger-zone-section.test.tsx`
- `apps/frontend/src/features/programs/program-edit-lifecycle-section.tsx`
- `apps/frontend/src/features/programs/program-edit-page.test.tsx`
- `apps/frontend/src/features/programs/program-edit-view.test.tsx`
- `apps/frontend/src/features/programs/program-edit-view.tsx`
- `apps/frontend/src/features/programs/program-edit-purge-confirmation.tsx`
- `apps/frontend/src/features/programs/program-edit-purge-summary.tsx`

No backend/API, archive, private-data, or foreign file was found. No reset was performed.

The prior failing-first proof remains represented by the baseline test/UI contract: the old ADMIN danger zone rendered both normal `삭제` and purge copy; the focused replacement asserts one `프로그램 영구 삭제` action and no normal-delete action.

## Pure LOC

- danger zone: 215
- purge confirmation: 117
- purge summary: 26

## Green gates

- Focused frontend: 46 tests passed.
- Backend purge unit tests unchanged: 54 tests passed across 4 suites.
- Full frontend test: 2,937 tests passed across 284 files.
- Frontend typecheck: passed.
- Frontend lint: passed with 5 pre-existing warnings in `sidebar-drawer.test.tsx`, no errors.
- Frontend production build: passed with the same pre-existing warnings.
- Prettier on changed source/test files: passed after formatting.
- `bash scripts/check-public-safe.sh origin/main`: passed.

## Browser evidence

Command:

```text
E2E_ARTIFACT_DIR=$PWD/.omo/evidence/task-5-browser E2E_RUN_ID=task5-purge-evidence E2E_STACK_PROFILE=program-authoring pnpm --filter frontend exec playwright test e2e/program-edit-purge-network.spec.ts --project=chrome
```

Result: **4 passed** in real Chrome against the real `/programs/:id/edit` route with frontend API interception and synthetic contract-accurate responses. Verified ADMIN purge-only action, exact `4/4/2/3` counts, wrong-name gating, expected scope, zero-count, protection, STAFF no-delete, cancel/focus restoration, scope-drift 409 without retry, and no normal `DELETE /programs/:id`.

Artifacts: `.omo/evidence/task-5-browser/admin-purge-success.png`, `purge-network-request-log.json`, plus Playwright traces/screenshots from the run.

The original closest authoring run remains a pre-existing limitation: profile HTTP 422 and missing `팀별 서류 수합 표`.

No sleep was added and no private/real data was used.

## Submission status

Ready for commit and PR; no merge performed.
