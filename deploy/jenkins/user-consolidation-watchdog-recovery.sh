#!/usr/bin/env bash
# Sourced by the bounded, locked host rollback action after writers are fenced.
node "$run/helpers/user-consolidation-watchdog-state.mjs" rollback-allowed "$run"
if [[ "$(query "SELECT to_regclass('public.\"UserPolicy\"') IS NULL")" != t ]]; then
  sql "$run/sql/rollback.sql"
else
  sql "$run/sql/preflight.sql"
  [[ "$(query "SELECT to_regclass('public.\"Admin\"') IS NULL AND to_regclass('public.\"UserHistory\"') IS NULL AND to_regclass('public.\"AdminHistory\"') IS NULL")" == t ]]
  if [[ "$(query "SELECT to_regclass('user_consolidation_backup.control') IS NULL")" != t ]]; then
    [[ "$(query 'SELECT phase FROM user_consolidation_backup.control')" == ROLLED_BACK ]]
  fi
  migration_id="$(jq -er .migrationId "$run/sql/manifest.json")"
  previous_migration_id="$(jq -er .previousMigrationId "$run/sql/manifest.json")"
  [[ "$migration_id" == 20261102160000_consolidate_user_domain ]]
  [[ "$previous_migration_id" =~ ^[0-9]{14}_[a-z0-9_]+$ ]]
  ledger_query="SELECT coalesce(json_agg(t), '[]'::json) FROM (SELECT migration_name, checksum, finished_at, rolled_back_at, extract(epoch FROM started_at) AS \"startedEpoch\" FROM \"_prisma_migrations\" WHERE migration_name='$migration_id' OR (finished_at IS NULL AND rolled_back_at IS NULL) OR (migration_name>'$previous_migration_id' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)) t"
  decision="$(node "$run/helpers/user-consolidation-watchdog-state.mjs" failed-attempt "$run" "$(query "$ledger_query")")"
  if [[ "$decision" == resolve ]]; then
    node "$run/helpers/user-consolidation-watchdog-state.mjs" rollback-allowed "$run"
    migration_client
    resolve_status=0
    docker exec oss-hub-uc-migrate ./node_modules/.bin/prisma migrate resolve \
      --rolled-back "$migration_id" --schema prisma/schema.prisma || resolve_status=$?
    remove_container oss-hub-uc-migrate
    close_remote
    [[ "$resolve_status" == 0 ]]
    sql "$run/sql/preflight.sql"
    [[ "$(node "$run/helpers/user-consolidation-watchdog-state.mjs" failed-attempt "$run" "$(query "$ledger_query")")" == clean ]]
  fi
fi
