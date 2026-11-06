-- Release A's names must all be present and release B's names absent, so the rename has exactly the objects it expects.
WITH old_relations(name) AS (
  VALUES ('MilestoneDocument'), ('MilestoneDocumentSubmission'), ('MilestoneDocumentSubmissionHistory'),
    ('MilestoneDocument_milestoneId_sortOrder_idx'),
    ('MilestoneDocumentSubmission_milestoneDocumentId_teamId_key'),
    ('MilestoneDocumentSubmission_teamId_idx'),
    ('MilestoneDocumentSubmission_submittedById_idx'),
    ('MilestoneDocumentSubmissionHistory_milestoneDocumentSubmissionI'),
    ('MilestoneDocumentSubmissionHistory_actorId_idx'),
    ('GithubRepository_teamId_key')
), old_constraints(name) AS (
  VALUES ('MilestoneDocument_pkey'), ('MilestoneDocument_milestoneId_fkey'),
    ('MilestoneDocumentSubmission_pkey'), ('MilestoneDocumentSubmission_milestoneDocumentId_fkey'),
    ('MilestoneDocumentSubmission_teamId_fkey'), ('MilestoneDocumentSubmission_submittedById_fkey'),
    ('MilestoneDocumentSubmissionHistory_pkey'), ('MilestoneDocumentSubmissionHistory_submissionId_fkey'),
    ('MilestoneDocumentSubmissionHistory_actorId_fkey')
), old_types(name) AS (
  VALUES ('MilestoneDocumentKind'), ('MilestoneDocumentSubmissionHistoryEvent')
), old_columns(relation, name) AS (
  VALUES ('MilestoneDocumentSubmission', 'milestoneDocumentId'),
    ('MilestoneDocumentSubmissionHistory', 'milestoneDocumentSubmissionId')
), new_names(name) AS (
  VALUES ('Requirement'), ('Submission'), ('SubmissionHistory'), ('RequirementKind'), ('SubmissionHistoryEvent')
)
SELECT
  (SELECT count(*) FROM old_relations o WHERE NOT EXISTS (
    SELECT 1 FROM pg_class c WHERE c.relnamespace = current_schema()::regnamespace AND c.relname = o.name))
  + (SELECT count(*) FROM old_constraints o WHERE NOT EXISTS (
    SELECT 1 FROM pg_constraint c WHERE c.connamespace = current_schema()::regnamespace AND c.conname = o.name))
  + (SELECT count(*) FROM old_types o WHERE NOT EXISTS (
    SELECT 1 FROM pg_type t WHERE t.typnamespace = current_schema()::regnamespace AND t.typname = o.name))
  + (SELECT count(*) FROM old_columns o WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = current_schema() AND c.table_name = o.relation AND c.column_name = o.name))
  + (SELECT count(*) FROM new_names n WHERE EXISTS (
    SELECT 1 FROM pg_class c WHERE c.relnamespace = current_schema()::regnamespace AND c.relname = n.name)
    OR EXISTS (
    SELECT 1 FROM pg_type t WHERE t.typnamespace = current_schema()::regnamespace AND t.typname = n.name))
  -- Function bodies are text and would still name the old tables after the rename.
  + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND p.prosrc ~ 'MilestoneDocument|milestoneDocument(Submission)?Id')
  -- The rebuilt full unique index must accept every row the partial one accepted.
  + (SELECT count(*) FROM (
    SELECT "teamId" FROM "GithubRepository" WHERE "teamId" IS NOT NULL GROUP BY "teamId" HAVING count(*) > 1
  ) duplicate);
