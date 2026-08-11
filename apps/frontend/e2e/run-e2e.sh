#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
frontend_dir="$(cd -- "${script_dir}/.." && pwd)"
repo_root="$(cd -- "${frontend_dir}/../.." && pwd)"

pick_port() {
  node -e 'const net=require("node:net");const server=net.createServer();server.listen(0,"127.0.0.1",()=>{const address=server.address();if(typeof address!=="object"||address===null)process.exit(1);process.stdout.write(String(address.port));server.close();});'
}

run_id="${E2E_RUN_ID:-$(date +%s)-$$-$RANDOM}"
run_slug="${run_id//[^A-Za-z0-9]/_}"
run_slug="${run_slug:0:32}"

export E2E_FRONTEND_PORT="${E2E_FRONTEND_PORT:-$(pick_port)}"
export E2E_BACKEND_PORT="${E2E_BACKEND_PORT:-$(pick_port)}"
export E2E_POSTGRES_PORT="${E2E_POSTGRES_PORT:-0}"
export E2E_COMPOSE_PROJECT_NAME="${E2E_COMPOSE_PROJECT_NAME:-oss-hub-e2e-${run_slug}}"
export E2E_POSTGRES_DB="${E2E_POSTGRES_DB:-oss_hub_e2e_${run_slug}}"
export E2E_SESSION_SECRET="${E2E_SESSION_SECRET:-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA}"
export E2E_ARTIFACT_DIR="${E2E_ARTIFACT_DIR:-$repo_root/.omo/artifacts/program-authoring-and-document-flow/12-e2e}"

exec pnpm --dir "$frontend_dir" exec playwright test "$@"
