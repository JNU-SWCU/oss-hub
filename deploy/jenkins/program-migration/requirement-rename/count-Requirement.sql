-- Counts the same table under either name, so the number is comparable across the rename.
SELECT (xpath('/row/count/text()', query_to_xml(
  'SELECT count(*) FROM ' || COALESCE(to_regclass('"Requirement"'), to_regclass('"MilestoneDocument"'))::text,
  false, true, '')))[1]::text::bigint;
