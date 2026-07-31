#!/usr/bin/env bash

set -euo pipefail

support_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$support_directory/backend-env.sh"

sanitized_home="$(mktemp -d "${TMPDIR:-/tmp}/oss-hub-e2e-home-test.XXXXXX")"
trap 'rm -rf "$sanitized_home"' EXIT

# Given: representative live-capable and unknown parent variables hold sentinels.
export E2E_UNKNOWN_PARENT_CREDENTIAL_PATH=sentinel-must-not-reach-child
export GITHUB_APP_ORG=sentinel-must-not-reach-child
export GITHUB_COLLECTION_APP_ID=sentinel-must-not-reach-child
export GITHUB_COLLECTION_APP_PRIVATE_KEY=sentinel-must-not-reach-child
export GITHUB_COLLECTION_APP_PRIVATE_KEY_FILE=sentinel-must-not-reach-child
export GITHUB_COLLECTION_APP_API_BASE_URL=sentinel-must-not-reach-child
export GITHUB_COLLECTION_APP_MAX_PAGES=sentinel-must-not-reach-child
export GITHUB_COLLECTION_APP_DEADLINE_MS=sentinel-must-not-reach-child
export GITHUB_COLLECTION_APP_SMOKE_PUBLIC_ALIASES=sentinel-must-not-reach-child
export GITHUB_COLLECTION_APP_SMOKE_PRIVATE_ALIAS=sentinel-must-not-reach-child
export GITHUB_OPERATIONS_APP_ID=sentinel-must-not-reach-child
export GITHUB_OPERATIONS_APP_PRIVATE_KEY=sentinel-must-not-reach-child
export GITHUB_OPERATIONS_APP_PRIVATE_KEY_FILE=sentinel-must-not-reach-child
export COLLECTION_CRON_EXPRESSION=sentinel-must-not-reach-child
export AUTH_INITIAL_ROLES=sentinel-must-not-reach-child
export SUBMISSION_FILE_CLEANUP_MAINTENANCE_ENABLED=sentinel-must-not-reach-child
export SUBMISSION_FILE_CLEANUP_OPERATOR_ID=sentinel-must-not-reach-child

tool_path="$(dirname "$(command -v node)"):/usr/bin:/bin"

# When: the same allowlisted launcher used by run-stack starts a child process.
e2e_backend_server_env \
  "$tool_path" \
  "$sanitized_home" \
  postgresql://synthetic-e2e-database \
  AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA \
  http://127.0.0.1:3300 \
  4300 \
  node "$support_directory/backend-env.probe.mjs"

# Then: the probe exits zero only when sentinels are absent and test values win.
printf 'backend env isolation: ok\n'
