BEGIN;

-- Keep the populated projections as the preparation layer. Initial publication
-- copies their compact results; it does not backfill the ledger a second time.
ALTER MATERIALIZED VIEW ranking_activity_snapshot RENAME TO ranking_activity_prepared;
ALTER INDEX ranking_activity_snapshot_key RENAME TO ranking_activity_prepared_key;
ALTER MATERIALIZED VIEW ranking_streak_snapshot RENAME TO ranking_streak_prepared;
ALTER INDEX ranking_streak_snapshot_key RENAME TO ranking_streak_prepared_key;

CREATE MATERIALIZED VIEW ranking_activity_snapshot AS SELECT * FROM ranking_activity_prepared;
CREATE UNIQUE INDEX ranking_activity_snapshot_key
  ON ranking_activity_snapshot (github_id, year, visibility, current_row);
CREATE MATERIALIZED VIEW ranking_streak_snapshot AS SELECT * FROM ranking_streak_prepared;
CREATE UNIQUE INDEX ranking_streak_snapshot_key ON ranking_streak_snapshot (period, github_id);

COMMIT;
