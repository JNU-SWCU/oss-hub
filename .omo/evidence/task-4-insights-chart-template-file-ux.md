# Task 4 evidence

- Contract: `MilestoneDocumentTemplateFile.originalFileName` is selected explicitly and mapped to `templateFileName: string | null`.
- `hasTemplateFile` remains derived from the selected relation id, so present/null states stay coherent.
- No storage URL/key is selected or returned; no Prisma migration, authorization, or UI rendering changed.
- Red proof: the first targeted backend run failed at TypeScript compilation because the new characterization assertions referenced the not-yet-added repository contract (`hasTemplateFile` is DTO-derived and `templateFileName` was absent). Production edits followed that captured failure.
- Green proof: `pnpm --filter backend exec jest src/milestone-documents/milestone-documents.repository.spec.ts --runInBand` (63 passed); `pnpm --filter frontend exec vitest run src/features/programs/milestone-document-list-response.test.ts` (5 passed).
- Gates: backend/frontend typecheck and lint passed; frontend build passed. Frontend lint/build retain five pre-existing Next link warnings in `sidebar-drawer.test.tsx`.
- API driver: no authenticated local backend credentials/database were available in this isolated worktree, so no real-data request was made. The synthetic contract fixture and focused parser test cover present/null mapping without exposing storage metadata.
