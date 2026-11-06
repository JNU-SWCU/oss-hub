-- Every name Prisma derives for the three tables exists, and no MilestoneDocument name is left.
WITH new_relations(name) AS (
  VALUES ('Requirement'), ('Submission'), ('SubmissionHistory'),
    ('Requirement_milestoneId_sortOrder_idx'),
    ('Submission_requirementId_teamId_key'),
    ('Submission_teamId_idx'),
    ('Submission_submittedById_idx'),
    ('SubmissionHistory_submissionId_createdAt_idx'),
    ('SubmissionHistory_actorId_idx')
), new_constraints(name) AS (
  VALUES ('Requirement_pkey'), ('Requirement_milestoneId_fkey'),
    ('Submission_pkey'), ('Submission_requirementId_fkey'),
    ('Submission_teamId_fkey'), ('Submission_submittedById_fkey'),
    ('SubmissionHistory_pkey'), ('SubmissionHistory_submissionId_fkey'),
    ('SubmissionHistory_actorId_fkey')
), new_types(name) AS (
  VALUES ('RequirementKind'), ('SubmissionHistoryEvent')
), new_columns(relation, name) AS (
  VALUES ('Submission', 'requirementId'), ('SubmissionHistory', 'submissionId')
)
SELECT
  (SELECT count(*) FROM new_relations r WHERE NOT EXISTS (
    SELECT 1 FROM pg_class c WHERE c.relnamespace = current_schema()::regnamespace AND c.relname = r.name))
  + (SELECT count(*) FROM new_constraints r WHERE NOT EXISTS (
    SELECT 1 FROM pg_constraint c WHERE c.connamespace = current_schema()::regnamespace AND c.conname = r.name))
  + (SELECT count(*) FROM new_types r WHERE NOT EXISTS (
    SELECT 1 FROM pg_type t WHERE t.typnamespace = current_schema()::regnamespace AND t.typname = r.name))
  + (SELECT count(*) FROM new_columns r WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = current_schema() AND c.table_name = r.relation AND c.column_name = r.name))
  + (SELECT count(*) FROM pg_class c
    WHERE c.relnamespace = current_schema()::regnamespace AND c.relname ~ '^MilestoneDocument')
  + (SELECT count(*) FROM pg_constraint c
    WHERE c.connamespace = current_schema()::regnamespace AND c.conname ~ '^MilestoneDocument')
  + (SELECT count(*) FROM pg_type t
    WHERE t.typnamespace = current_schema()::regnamespace AND t.typname ~ '^_?MilestoneDocument')
  + (SELECT count(*) FROM information_schema.columns c
    WHERE c.table_schema = current_schema() AND c.column_name IN ('milestoneDocumentId', 'milestoneDocumentSubmissionId'))
  + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND p.prosrc ~ 'MilestoneDocument|milestoneDocument(Submission)?Id')
  -- Prisma sees only a full unique index.
  + (SELECT CASE WHEN count(*) = 1 THEN 0 ELSE 1 END FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relnamespace = current_schema()::regnamespace AND c.relname = 'GithubRepository_teamId_key'
      AND i.indisunique AND i.indpred IS NULL);
