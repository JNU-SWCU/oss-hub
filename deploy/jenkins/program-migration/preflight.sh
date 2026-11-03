#!/usr/bin/env bash
# shellcheck source=deploy/jenkins/program-migration/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

manifest="${1:-}"
[[ -n "$manifest" && "$#" == 1 ]] || pm_fail 'usage: preflight.sh <manifest>'
pm_require_container
node "$PM_DIR/manifest.mjs" "$manifest" validate

pm_manifest_list "$manifest" head
expected="${PM_LIST[0]}"
ledger_sql="SELECT count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) || '|' || coalesce(max(migration_name) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL), '') FROM public._prisma_migrations"
rc=0
ledger="$(pm_psql on "$PM_CHECK_TIMEOUT" "$PM_STATEMENT_TIMEOUT_MS" "${PM_DATABASE:-}" -c "$ledger_sql" </dev/null)" || rc=$?
[[ "$rc" == 0 ]] || pm_fail "preflight ledger query: $(pm_describe_exit "$rc")"
[[ "$ledger" == "0|$expected" ]] || pm_fail "preflight ledger mismatch: expected 0|$expected, got $ledger"

pm_manifest_list "$manifest" preflight
pm_run_checks "${PM_LIST[@]}" || pm_fail 'preflight checks failed'
printf 'PREFLIGHT_OK head=%s checks=%s\n' "$expected" "${#PM_LIST[@]}"
