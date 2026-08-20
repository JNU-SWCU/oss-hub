# Task 4 evidence

- Contract: `MilestoneDocumentTemplateFile.originalFileName` is selected explicitly and mapped to `templateFileName: string | null`.
- `hasTemplateFile` remains derived from the selected relation id, so present/null states stay coherent.
- No storage URL/key is selected or returned; no Prisma migration, authorization, or UI rendering changed.
- Red proof: the first targeted backend run failed at TypeScript compilation because the new characterization assertions referenced the not-yet-added repository contract (`hasTemplateFile` is DTO-derived and `templateFileName` was absent). Production edits followed that captured failure.
- Green proof: `pnpm --filter backend exec jest src/milestone-documents/milestone-documents.repository.spec.ts --runInBand` (63 passed); `pnpm --filter frontend exec vitest run src/features/programs/milestone-document-list-response.test.ts` (5 passed).
- Gates: backend/frontend typecheck and lint passed; frontend build passed. Frontend lint/build retain five pre-existing Next link warnings in `sidebar-drawer.test.tsx`.
- Durable authenticated integration regression: `apps/backend/src/milestone-documents/milestone-document-list.http.integration.spec.ts`.
- Reproducible command/output: `BACKEND_INTEGRATION_TEST_PATTERN='milestone-document-list\\.http\\.integration\\.spec\\.ts$' bash scripts/run-backend-integration.sh` -> `PASS .../milestone-document-list.http.integration.spec.ts`, `1 passed`, `1 test suite passed`.
- Observed HTTP `200` body contained `templateFileName: "운영결과보고서_2026.docx", hasTemplateFile: true` for the synthetic template and `templateFileName: null, hasTemplateFile: false` for the absent template. The body contained no `storageKey`, synthetic object key, or `http://`/`https://` URL; the frontend parser consumed the same JSON shape in the focused Vitest.
- The harness applied migrations only to isolated temporary PostgreSQL/MinIO containers, used synthetic rows, and its EXIT trap removed all containers/volumes. Cleanup receipt: `docker ps --format '{{.Names}}' | grep -E 'oss-hub-test-' || true` returned no output. No real credentials/data or sleeps were used.
