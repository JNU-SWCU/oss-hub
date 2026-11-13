BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL TIME ZONE 'UTC';

DO $$
DECLARE
  source_rows bigint;
  inserted_rows bigint;
  colliding_rows bigint;
  orphan_keys bigint;
BEGIN
  SELECT COUNT(*) INTO source_rows
  FROM "GithubUserActivityMonthly" AS m
  WHERE m.year = 2026 AND m.month < 11;

  SELECT COUNT(*) INTO colliding_rows
  FROM "GithubUserActivityMonthly" AS m
  JOIN github_user_activity_history AS h
    ON h.github_id = m."githubId"
   AND h.year = m.year
   AND h.visibility = 'PUBLIC'
   AND h.observed_at = m."observedAt" AT TIME ZONE 'UTC'
  WHERE m.year = 2026 AND m.month < 11;

  SELECT COUNT(DISTINCT (m."githubId", m.year)) INTO orphan_keys
  FROM "GithubUserActivityMonthly" AS m
  WHERE m.year = 2026 AND m.month < 11
    AND NOT EXISTS (
      SELECT 1 FROM github_user_activity_history AS h
      WHERE h.github_id = m."githubId"
        AND h.year = m.year
        AND h.visibility = 'PUBLIC'
    );

  IF colliding_rows <> 0 OR orphan_keys <> 0 THEN
    RAISE EXCEPTION 'gm-a precondition failed: collisions=%, orphan_keys=%',
      colliding_rows, orphan_keys;
  END IF;

  INSERT INTO github_user_activity_history (
    github_id, year, visibility,
    commit_count, pull_request_count, issue_count, repository_count, star_count,
    observed_at, clock_at
  )
  SELECT
    m."githubId", m.year, 'PUBLIC',
    m."commitCount", m."pullRequestCount", m."issueCount",
    m."repositoryCount", m."starCount",
    m."observedAt" AT TIME ZONE 'UTC', NULL
  FROM "GithubUserActivityMonthly" AS m
  WHERE m.year = 2026 AND m.month < 11
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted_rows = ROW_COUNT;

  IF inserted_rows <> source_rows THEN
    RAISE EXCEPTION 'gm-a inserted % rows, expected %', inserted_rows, source_rows;
  END IF;
END
$$;

COMMIT;
