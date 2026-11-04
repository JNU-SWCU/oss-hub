#!/usr/bin/env bash
# shellcheck source=deploy/jenkins/program-migration/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

manifest="${1:-}"
stage="${2:-}"
[[ -n "$manifest" && -n "$stage" && "$#" == 2 ]] || pm_fail 'usage: reconcile.sh <manifest> <stage-id>'
pm_require_container

pm_manifest_list "$manifest" stage-reconcile "$stage"
pm_run_checks "${PM_LIST[@]}" || pm_fail "reconcile failed for stage $stage"
printf 'RECONCILE_OK stage=%s checks=%s\n' "$stage" "${#PM_LIST[@]}"
