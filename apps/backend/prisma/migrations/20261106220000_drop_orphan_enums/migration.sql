BEGIN;
SET LOCAL lock_timeout = '5s';

-- No column, domain, function or other type uses these enum types any more.
-- The guard names anything that still depends on a type or its array type, or any function
-- whose body names a type, and aborts.
-- DROP TYPE runs without CASCADE, so a dependency the guard misses still fails the migration.
DO $$
DECLARE
  dependents TEXT;
BEGIN
  dependents := (
    SELECT string_agg(DISTINCT pg_describe_object(d.classid, d.objid, d.objsubid), ', ')
    FROM pg_type AS t
    JOIN pg_depend AS d
      ON d.refclassid = 'pg_type'::regclass
     AND d.refobjid IN (t.oid, t.typarray)
    WHERE t.typnamespace = current_schema()::regnamespace
      AND t.typname IN ('MilestoneSubmissionType', 'RequirementKind', 'ReviewDecision')
      AND NOT (d.classid = 'pg_type'::regclass AND d.objid = t.typarray)
  );

  IF dependents IS NOT NULL THEN
    RAISE EXCEPTION 'orphan enum removal aborted; still in use by: %', dependents
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  -- Function bodies are text, so pg_depend does not see a type named inside them.
  dependents := (
    SELECT string_agg(p.oid::regprocedure::text, ', ')
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND p.prosrc ~ 'MilestoneSubmissionType|RequirementKind|ReviewDecision'
  );

  IF dependents IS NOT NULL THEN
    RAISE EXCEPTION 'orphan enum removal aborted; a function body names a type: %', dependents
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;
END $$;

DROP TYPE "MilestoneSubmissionType";
DROP TYPE "RequirementKind";
DROP TYPE "ReviewDecision";

COMMIT;
