#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
checker="$repo_root/scripts/check-production-image-pins.sh"
fixture_root=$(mktemp -d "${TMPDIR:-/tmp}/production-image-pins.XXXXXX")
trap 'rm -rf "$fixture_root"' EXIT

passed=0
failed=0

expect_pass() {
  local name=$1
  local output
  shift
  if output=$("$@" 2>&1); then
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  else
    printf 'not ok - %s (expected pass)\n' "$name" >&2
    printf '%s\n' "$output" >&2
    failed=$((failed + 1))
  fi
}

expect_fail() {
  local name=$1
  shift
  if "$@" >/dev/null 2>&1; then
    printf 'not ok - %s (expected fail)\n' "$name" >&2
    failed=$((failed + 1))
  else
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  fi
}

valid_compose="$fixture_root/compose-valid.yml"
cat >"$valid_compose" <<'YAML'
services:
  postgres:
    image: postgres:17-alpine@sha256:78b8838d6e9b53c624b1c4cfbd80a6f925fa7d86bbc10c6d07f6a8f9d597a29b
  backend:
    image: oss-hub-backend:${IMAGE_TAG:?IMAGE_TAG is required}
  nginx:
    image: nginx:1.27-alpine@sha256:9c2d18e18f5da38f4c45b720b2e8bc5e1ca1a8c920264f9b9828583fb4f625de
YAML

valid_dockerfile="$fixture_root/Dockerfile.valid"
cat >"$valid_dockerfile" <<'DOCKER'
FROM node:24-alpine@sha256:51f48f9a7f5e03c5e266d152c90c3f62fcbdfbd1ed98ff226ef87a94026b3bd4 AS dependencies
FROM dependencies AS builder
FROM node:24-alpine@sha256:51f48f9a7f5e03c5e266d152c90c3f62fcbdfbd1ed98ff226ef87a94026b3bd4 AS runtime
DOCKER

tag_only_compose="$fixture_root/compose-tag-only.yml"
cat >"$tag_only_compose" <<'YAML'
services:
  postgres:
    image: postgres:17-alpine
YAML

tag_only_dockerfile="$fixture_root/Dockerfile.tag-only"
cat >"$tag_only_dockerfile" <<'DOCKER'
FROM node:24-alpine AS runtime
DOCKER

digest_only_dockerfile="$fixture_root/Dockerfile.digest-only"
cat >"$digest_only_dockerfile" <<'DOCKER'
FROM node@sha256:51f48f9a7f5e03c5e266d152c90c3f62fcbdfbd1ed98ff226ef87a94026b3bd4 AS runtime
DOCKER

zero_digest_compose="$fixture_root/compose-zero.yml"
cat >"$zero_digest_compose" <<'YAML'
services:
  nginx:
    image: nginx:1.27-alpine@sha256:0000000000000000000000000000000000000000000000000000000000000000
YAML

expect_pass 'tag plus 64-hex digest pins pass' \
  bash "$checker" "$valid_compose" "$valid_dockerfile"
expect_fail 'Compose tag-only external image fails' \
  bash "$checker" "$tag_only_compose" "$valid_dockerfile"
expect_fail 'Dockerfile tag-only external FROM fails' \
  bash "$checker" "$valid_compose" "$tag_only_dockerfile"
expect_fail 'digest-only Dockerfile reference fails readable-tag contract' \
  bash "$checker" "$valid_compose" "$digest_only_dockerfile"
expect_fail 'all-zero digest placeholder fails' \
  bash "$checker" "$zero_digest_compose" "$valid_dockerfile"

printf '%s passed, %s failed\n' "$passed" "$failed"
((failed == 0))
