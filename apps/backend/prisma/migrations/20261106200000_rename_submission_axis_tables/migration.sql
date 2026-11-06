BEGIN;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL lock_timeout = '5s';

-- Todo 11 release B: the database takes the names the code already uses through @@map.
-- Only names change. No row, column type, default, index definition or foreign key action moves.
-- Release A reads the old names, so after a failed activation redeploy this candidate or restore the backup.
-- GithubRepository_teamId_key becomes a full unique index. NULLs stay distinct, so it accepts exactly
-- what the partial index accepted, and Prisma can now see it.
LOCK TABLE "MilestoneDocument", "MilestoneDocumentSubmission", "MilestoneDocumentSubmissionHistory",
  "GithubRepository"
  IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF to_regclass('public."Requirement"') IS NOT NULL
     OR to_regclass('public."Submission"') IS NOT NULL
     OR to_regclass('public."SubmissionHistory"') IS NOT NULL
     OR to_regtype('public."RequirementKind"') IS NOT NULL
     OR to_regtype('public."SubmissionHistoryEvent"') IS NOT NULL THEN
    RAISE EXCEPTION 'submission axis rename aborted: a new name already exists';
  END IF;
  -- Function bodies are text, so a rename would break them silently.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND p.prosrc ~ 'MilestoneDocument|milestoneDocument(Submission)?Id'
  ) THEN
    RAISE EXCEPTION 'submission axis rename aborted: a function body names the old tables';
  END IF;
END $$;

ALTER TABLE "MilestoneDocument" RENAME TO "Requirement";
ALTER TABLE "Requirement" RENAME CONSTRAINT "MilestoneDocument_pkey" TO "Requirement_pkey";
ALTER TABLE "Requirement" RENAME CONSTRAINT "MilestoneDocument_milestoneId_fkey" TO "Requirement_milestoneId_fkey";
ALTER INDEX "MilestoneDocument_milestoneId_sortOrder_idx" RENAME TO "Requirement_milestoneId_sortOrder_idx";

ALTER TABLE "MilestoneDocumentSubmission" RENAME TO "Submission";
ALTER TABLE "Submission" RENAME COLUMN "milestoneDocumentId" TO "requirementId";
ALTER TABLE "Submission" RENAME CONSTRAINT "MilestoneDocumentSubmission_pkey" TO "Submission_pkey";
ALTER TABLE "Submission" RENAME CONSTRAINT "MilestoneDocumentSubmission_milestoneDocumentId_fkey" TO "Submission_requirementId_fkey";
ALTER TABLE "Submission" RENAME CONSTRAINT "MilestoneDocumentSubmission_teamId_fkey" TO "Submission_teamId_fkey";
ALTER TABLE "Submission" RENAME CONSTRAINT "MilestoneDocumentSubmission_submittedById_fkey" TO "Submission_submittedById_fkey";
ALTER INDEX "MilestoneDocumentSubmission_milestoneDocumentId_teamId_key" RENAME TO "Submission_requirementId_teamId_key";
ALTER INDEX "MilestoneDocumentSubmission_teamId_idx" RENAME TO "Submission_teamId_idx";
ALTER INDEX "MilestoneDocumentSubmission_submittedById_idx" RENAME TO "Submission_submittedById_idx";

ALTER TABLE "MilestoneDocumentSubmissionHistory" RENAME TO "SubmissionHistory";
ALTER TABLE "SubmissionHistory" RENAME COLUMN "milestoneDocumentSubmissionId" TO "submissionId";
ALTER TABLE "SubmissionHistory" RENAME CONSTRAINT "MilestoneDocumentSubmissionHistory_pkey" TO "SubmissionHistory_pkey";
ALTER TABLE "SubmissionHistory" RENAME CONSTRAINT "MilestoneDocumentSubmissionHistory_submissionId_fkey" TO "SubmissionHistory_submissionId_fkey";
ALTER TABLE "SubmissionHistory" RENAME CONSTRAINT "MilestoneDocumentSubmissionHistory_actorId_fkey" TO "SubmissionHistory_actorId_fkey";
-- PostgreSQL cut the original 64-character name at 63.
ALTER INDEX "MilestoneDocumentSubmissionHistory_milestoneDocumentSubmissionI" RENAME TO "SubmissionHistory_submissionId_createdAt_idx";
ALTER INDEX "MilestoneDocumentSubmissionHistory_actorId_idx" RENAME TO "SubmissionHistory_actorId_idx";

ALTER TYPE "MilestoneDocumentKind" RENAME TO "RequirementKind";
ALTER TYPE "MilestoneDocumentSubmissionHistoryEvent" RENAME TO "SubmissionHistoryEvent";

DROP INDEX "GithubRepository_teamId_key";
CREATE UNIQUE INDEX "GithubRepository_teamId_key" ON "GithubRepository"("teamId");

DO $$
DECLARE
  leftover text;
BEGIN
  SELECT string_agg(name, ', ' ORDER BY name) INTO leftover FROM (
    SELECT c.relname::text AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname ~ '^MilestoneDocument'
    UNION ALL
    SELECT c.conname::text FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public' AND c.conname ~ '^MilestoneDocument'
    UNION ALL
    SELECT t.typname::text FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname ~ '^_?MilestoneDocument'
    UNION ALL
    SELECT c.relname || '.' || a.attname FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    -- Index columns keep the name they were built with; nothing reads it, so only table columns count.
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT a.attisdropped
      AND a.attname IN ('milestoneDocumentId', 'milestoneDocumentSubmissionId')
  ) old;
  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION 'submission axis rename aborted: old names remain: %', leftover;
  END IF;
END $$;

COMMIT;
