#!/usr/bin/env bash

e2e_backend_tool_env() {
  local tool_path="$1"
  local sanitized_home="$2"
  local database_url="$3"
  shift 3

  env -i \
    PATH="$tool_path" \
    HOME="$sanitized_home" \
    NODE_ENV=test \
    DATABASE_URL="$database_url" \
    "$@"
}

e2e_backend_server_env() {
  local tool_path="$1"
  local sanitized_home="$2"
  local database_url="$3"
  local session_secret="$4"
  local frontend_origin="$5"
  local backend_port="$6"
  shift 6

  env -i \
    PATH="$tool_path" \
    HOME="$sanitized_home" \
    NODE_ENV=test \
    DATABASE_URL="$database_url" \
    SESSION_SECRET="$session_secret" \
    TEAM_JOIN_CODE_SECRET=synthetic-e2e-join-code-secret-at-least-32-bytes \
    FRONTEND_URL="$frontend_origin" \
    GITHUB_APP_ORG=e2e-org \
    GITHUB_OAUTH_CLIENT_ID=synthetic-e2e-client \
    GITHUB_OAUTH_CLIENT_SECRET=synthetic-e2e-client-secret \
    PORT="$backend_port" \
    MAIL_MODE=dry-run \
    E2E_PROGRAM_AUTHORING_CONTROL=enabled \
    "$@"
}
