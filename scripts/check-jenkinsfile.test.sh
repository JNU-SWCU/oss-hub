#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
checker="$repo_root/scripts/check-jenkinsfile.sh"
v2_source="$repo_root/Jenkinsfile"
fixture_dir=$(mktemp -d "${TMPDIR:-/tmp}/jenkinsfile-contract.XXXXXX")
trap 'rm -rf "$fixture_dir"' EXIT

passed=0
failed=0

expect_pass() {
  local name=$1
  local mode=$2
  local path=$3

  if "$checker" "$mode" "$path" >/dev/null 2>&1; then
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  else
    printf 'not ok - %s (성공해야 하지만 실패)\n' "$name" >&2
    failed=$((failed + 1))
  fi
}

expect_fail() {
  local name=$1
  local mode=$2
  local path=$3

  if "$checker" "$mode" "$path" >/dev/null 2>&1; then
    printf 'not ok - %s (실패해야 하지만 성공)\n' "$name" >&2
    failed=$((failed + 1))
  else
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  fi
}

make_fixture() {
  local source=$1
  local name=$2
  local pattern=$3
  local replacement=$4

  sed "s|$pattern|$replacement|" "$source" >"$fixture_dir/$name"
  if cmp -s "$source" "$fixture_dir/$name"; then
    printf 'fixture pattern not found: %s (%s)\n' "$pattern" "$name" >&2
    exit 1
  fi
}

append_fixture() {
  local source=$1
  local name=$2
  shift 2
  cp "$source" "$fixture_dir/$name"
  printf '%s\n' "$@" >>"$fixture_dir/$name"
}

# Root Jenkinsfile — 단일 parameterless Release 배포 계약
# ---------------------------------------------------------------------------
cp "$v2_source" "$fixture_dir/v2-valid"
make_fixture "$v2_source" v2-missing-concurrency 'disableConcurrentBuilds()' '/* removed */'
make_fixture "$v2_source" v2-missing-production-label "label 'oss-hub-production'" "label 'any'"
make_fixture "$v2_source" v2-missing-latest-release '/releases/latest' '/releases/removed'
make_fixture "$v2_source" v2-missing-draft-check "jq -r '.draft'" "jq -r '.removedDraft'"
make_fixture "$v2_source" v2-missing-prerelease-check "jq -r '.prerelease'" "jq -r '.removedPrerelease'"
make_fixture "$v2_source" v2-missing-tag-format 'tag ==~ /' 'tag !=~ /'
make_fixture "$v2_source" v2-missing-tag-resolution 'git rev-parse "${RELEASE_TAG}^{commit}"' 'git rev-parse HEAD'
make_fixture "$v2_source" v2-missing-main-ancestry 'git merge-base --is-ancestor "$release_sha" origin/main' 'true'
make_fixture "$v2_source" v2-moving-checkout 'git checkout --detach "$RELEASE_SHA"' 'git checkout main'
make_fixture "$v2_source" v2-missing-image-tag-release 'env.IMAGE_TAG = tag' 'env.IMAGE_TAG = releaseSha'
make_fixture "$v2_source" v2-missing-release-sha-binding 'env.RELEASE_SHA = releaseSha' 'env.RELEASE_SHA = env.IMAGE_TAG'
make_fixture "$v2_source" v2-missing-prisma-generate 'pnpm --filter backend exec prisma generate' 'true'
make_fixture "$v2_source" v2-missing-test 'pnpm test' 'true'
make_fixture "$v2_source" v2-missing-backup 'pg_dump' 'pg_isready'
make_fixture "$v2_source" v2-missing-migration 'npx prisma migrate deploy' 'npx prisma migrate status'
make_fixture "$v2_source" v2-missing-no-build 'docker compose --env-file "$OSS_HUB_ENV_FILE" up -d --no-build --wait' 'docker compose --env-file "$OSS_HUB_ENV_FILE" up -d --wait'
make_fixture "$v2_source" v2-missing-rollback-guard 'if (!env.PREV_TAG?.trim())' 'if (false)'
make_fixture "$v2_source" v2-missing-production-credential "credentialsId: 'oss-hub-production-env'" "credentialsId: 'removed'"
make_fixture "$v2_source" v2-missing-running-ps-q 'ps -q frontend' 'ps --status frontend'
make_fixture "$v2_source" v2-missing-all-ps 'ps --all -q frontend' 'ps -q frontend-all'
make_fixture "$v2_source" v2-missing-oci-version-label '--label "org.opencontainers.image.version=${RELEASE_TAG}"' '--label "org.opencontainers.image.title=${RELEASE_TAG}"'
make_fixture "$v2_source" v2-missing-oci-revision-label '--label "org.opencontainers.image.revision=${RELEASE_SHA}"' '--label "org.opencontainers.image.source=${RELEASE_SHA}"'
make_fixture "$v2_source" v2-restored-run-mode "env.DEPLOY_NOOP = 'false'" "env.RUN_MODE = 'release'"
append_fixture "$v2_source" v2-restored-big-integer 'new BigInteger("1")'
make_fixture "$v2_source" v2-restored-deploy-state-file "BACKUP_DIR = '/var/lib/oss-hub/backups'" "DEPLOY_STATE_FILE = '/var/lib/oss-hub/deploy-state/current-release'"

# parameters 블록 부활 → FAIL
{
  printf '%s\n' 'pipeline {'
  printf '%s\n' '  parameters {'
  printf '%s\n' "    string(name: 'RELEASE_ACTION', defaultValue: '', description: 'x')"
  printf '%s\n' "    string(name: 'RELEASE_TAG', defaultValue: '', description: 'x')"
  printf '%s\n' '  }'
  tail -n +2 "$v2_source"
} >"$fixture_dir/v2-restored-parameters"
if cmp -s "$v2_source" "$fixture_dir/v2-restored-parameters"; then
  printf 'fixture not distinct: v2-restored-parameters\n' >&2
  exit 1
fi

append_fixture "$v2_source" v2-restored-release-accept \
  "sh \"echo 'RELEASE_ACCEPT role=PM tag=v0.0.0 head=0000000000000000000000000000000000000000'\""
append_fixture "$v2_source" v2-restored-release-comment-scraping \
  "sh 'curl https://api.github.com/repos/JNU-SWCU/oss-hub/issues/199/comments'"
append_fixture "$v2_source" v2-restored-pm-actor-parsing \
  "sh \"jq --arg actor 'GoBeromsu'\""
append_fixture "$v2_source" v2-restored-tech-lead-accept \
  "sh \"echo 'RELEASE_ACCEPT role=TECH_LEAD tag=v0.0.0 head=0000000000000000000000000000000000000000'\""
append_fixture "$v2_source" v2-restored-pm-override \
  "sh \"echo 'RELEASE_OVERRIDE role=PM tag=v0.0.0 head=0000000000000000000000000000000000000000'\""

append_fixture "$v2_source" v2-destructive-volume-removal 'docker compose down -v'
append_fixture "$v2_source" v2-main-auto-deploy "branch 'main'"
append_fixture "$v2_source" v2-duplicate-frontend-build 'docker build --file apps/frontend/Dockerfile --tag "oss-hub-frontend:${IMAGE_TAG}" .'
append_fixture "$v2_source" v2-reassigned-image-tag "env.IMAGE_TAG = 'latest'"
append_fixture "$v2_source" v2-exported-image-tag "sh 'export IMAGE_TAG=latest'"
append_fixture "$v2_source" v2-extra-image-build "sh 'docker image build --tag extra:latest .'"
append_fixture "$v2_source" v2-compose-image-build "sh 'docker compose build'"
append_fixture "$v2_source" v2-compose-up-build "sh 'docker compose up -d --build'"

cp "$v2_source" "$fixture_dir/v2-continued-image-build"
{
  printf "\nsh '''\n"
  printf '%s\n' '  docker image \'
  printf '%s\n' '    build --tag extra:latest .'
  printf "'''\n"
} >>"$fixture_dir/v2-continued-image-build"

cp "$v2_source" "$fixture_dir/v2-continued-volume-removal"
{
  printf "\nsh '''\n"
  printf '%s\n' '  docker compose down \'
  printf '%s\n' '    --volumes'
  printf "'''\n"
} >>"$fixture_dir/v2-continued-volume-removal"

# --- Architecture blocker synthetic mutations (independent of checker text) ---

# 1) SemVer downgrade: mutate the bounded comparison (cmp < 0 → cmp > 0)
make_fixture "$v2_source" v2-blocker-downgrade-cmp-flipped 'if (cmp < 0)' 'if (cmp > 0)'

# 1b) SemVer downgrade: mutate the no-op assignment inside the cmp branch
awk '
  /if \(cmp < 0\) \{/ { print; getline; sub(/DEPLOY_NOOP = '\''true'\''/, "DEPLOY_NOOP = '\''false'\''"); print; next }
  { print }
' "$v2_source" >"$fixture_dir/v2-blocker-downgrade-noop-false"
if cmp -s "$v2_source" "$fixture_dir/v2-blocker-downgrade-noop-false"; then
  printf 'fixture not distinct: v2-blocker-downgrade-noop-false\n' >&2
  exit 1
fi

# 2) stopped container: keep diagnostic marker, remove terminal exit → proceeds
awk '
  /FAIL_CLOSED stopped_container/ {
    print
    # drop following terminal exit line(s) until fi, keep diagnostics
    while ((getline line) > 0) {
      if (line ~ /^[[:space:]]*exit[[:space:]]+[0-9]+[[:space:]]*$/) continue
      print line
      if (line ~ /^[[:space:]]*fi[[:space:]]*$/) break
    }
    next
  }
  { print }
' "$v2_source" >"$fixture_dir/v2-blocker-stopped-proceeds"
if cmp -s "$v2_source" "$fixture_dir/v2-blocker-stopped-proceeds"; then
  printf 'fixture not distinct: v2-blocker-stopped-proceeds\n' >&2
  exit 1
fi
# sanity: diagnostic remains, terminal exit in stopped branch is gone
if ! grep -Fq 'FAIL_CLOSED stopped_container' "$fixture_dir/v2-blocker-stopped-proceeds"; then
  printf 'fixture lost diagnostic: v2-blocker-stopped-proceeds\n' >&2
  exit 1
fi
if awk '
  /FAIL_CLOSED stopped_container/ { grab=1; next }
  grab {
    if ($0 ~ /exit[[:space:]]+[0-9]+/) found=1
    if ($0 ~ /^[[:space:]]*fi[[:space:]]*$/) exit
  }
  END { exit found ? 0 : 1 }
' "$fixture_dir/v2-blocker-stopped-proceeds"; then
  printf 'fixture still terminals: v2-blocker-stopped-proceeds\n' >&2
  exit 1
fi

# 2b) non-running probe state: keep condition, remove terminal error(...)
awk '
  /if \(state != '\''running'\''\) \{/ {
    print
    while ((getline line) > 0) {
      if (line ~ /error[[:space:]]*\(/) continue
      print line
      if (line ~ /^[[:space:]]*\}[[:space:]]*$/) break
    }
    next
  }
  { print }
' "$v2_source" >"$fixture_dir/v2-blocker-ambiguous-proceeds"
if cmp -s "$v2_source" "$fixture_dir/v2-blocker-ambiguous-proceeds"; then
  printf 'fixture not distinct: v2-blocker-ambiguous-proceeds\n' >&2
  exit 1
fi
if ! grep -Fq "if (state != 'running')" "$fixture_dir/v2-blocker-ambiguous-proceeds"; then
  printf 'fixture lost condition: v2-blocker-ambiguous-proceeds\n' >&2
  exit 1
fi
if awk '
  /if \(state != '\''running'\''\) \{/ { grab=1; next }
  grab {
    if ($0 ~ /error[[:space:]]*\(/) found=1
    if ($0 ~ /^[[:space:]]*\}[[:space:]]*$/) exit
  }
  END { exit found ? 0 : 1 }
' "$fixture_dir/v2-blocker-ambiguous-proceeds"; then
  printf 'fixture still terminals: v2-blocker-ambiguous-proceeds\n' >&2
  exit 1
fi

# 2c) partial deployment: keep diagnostic, remove terminal exit
awk '
  /FAIL_CLOSED partial_deployment/ {
    print
    while ((getline line) > 0) {
      if (line ~ /^[[:space:]]*exit[[:space:]]+[0-9]+[[:space:]]*$/) continue
      print line
      if (line ~ /^[[:space:]]*fi[[:space:]]*$/) break
    }
    next
  }
  { print }
' "$v2_source" >"$fixture_dir/v2-blocker-partial-proceeds"
if cmp -s "$v2_source" "$fixture_dir/v2-blocker-partial-proceeds"; then
  printf 'fixture not distinct: v2-blocker-partial-proceeds\n' >&2
  exit 1
fi
if ! grep -Fq 'FAIL_CLOSED partial_deployment' "$fixture_dir/v2-blocker-partial-proceeds"; then
  printf 'fixture lost diagnostic: v2-blocker-partial-proceeds\n' >&2
  exit 1
fi

# 3) same-tag/different-SHA: keep condition + diagnostic text, remove terminal error(...)
awk '
  /prevTag == env.RELEASE_TAG && prevSha != env.RELEASE_SHA/ {
    print
    while ((getline line) > 0) {
      if (index(line, "error(") > 0) {
        # keep diagnostic marker text as a non-terminal echo
        print "              echo \"FAIL_CLOSED same_tag_different_sha: retag SHA mismatch (non-terminal)\""
        continue
      }
      print line
      if (line ~ /^[[:space:]]*\}[[:space:]]*$/) break
    }
    next
  }
  { print }
' "$v2_source" >"$fixture_dir/v2-blocker-same-tag-different-sha-removed"
if cmp -s "$v2_source" "$fixture_dir/v2-blocker-same-tag-different-sha-removed"; then
  printf 'fixture not distinct: v2-blocker-same-tag-different-sha-removed\n' >&2
  exit 1
fi
if ! grep -Fq 'prevTag == env.RELEASE_TAG && prevSha != env.RELEASE_SHA' \
  "$fixture_dir/v2-blocker-same-tag-different-sha-removed"; then
  printf 'fixture lost condition: v2-blocker-same-tag-different-sha-removed\n' >&2
  exit 1
fi
if ! grep -Fq 'FAIL_CLOSED same_tag_different_sha' \
  "$fixture_dir/v2-blocker-same-tag-different-sha-removed"; then
  printf 'fixture lost diagnostic: v2-blocker-same-tag-different-sha-removed\n' >&2
  exit 1
fi
if awk '
  /prevTag == env.RELEASE_TAG && prevSha != env.RELEASE_SHA/ { grab=1; next }
  grab {
    if (index($0, "error(") > 0) found=1
    if ($0 ~ /^[[:space:]]*\}[[:space:]]*$/) exit
  }
  END { exit found ? 0 : 1 }
' "$fixture_dir/v2-blocker-same-tag-different-sha-removed"; then
  printf 'fixture still terminals: v2-blocker-same-tag-different-sha-removed\n' >&2
  exit 1
fi

make_fixture "$v2_source" v2-blocker-missing-rollback-script \
  'bash scripts/jenkins/validate-rollback-images.sh' \
  'true'
make_fixture "$v2_source" v2-blocker-rollback-nonzero-swallowed \
  "sh 'bash scripts/jenkins/validate-rollback-images.sh'" \
  "sh(script: 'bash scripts/jenkins/validate-rollback-images.sh', returnStatus: true)"
make_fixture "$v2_source" v2-blocker-missing-rollback-prev-tag \
  '"PREV_TAG=${env.PREV_TAG}",' \
  '"PREV_TAG=${MISSING_PREV_TAG}",'
make_fixture "$v2_source" v2-blocker-missing-rollback-prev-sha \
  "PREV_SHA=\${env.PREV_SHA ?: ''}" \
  "PREV_SHA=\${MISSING_PREV_SHA ?: ''}"
make_fixture "$v2_source" v2-blocker-missing-rollback-prev-fe-id \
  "PREV_FE_IMAGE_ID=\${env.PREV_FE_IMAGE_ID ?: ''}" \
  "PREV_FE_IMAGE_ID=\${MISSING_PREV_FE_IMAGE_ID ?: ''}"
make_fixture "$v2_source" v2-blocker-missing-rollback-prev-be-id \
  "PREV_BE_IMAGE_ID=\${env.PREV_BE_IMAGE_ID ?: ''}" \
  "PREV_BE_IMAGE_ID=\${MISSING_PREV_BE_IMAGE_ID ?: ''}"

# 5a) HTTP FRONTEND_URL acceptance
make_fixture "$v2_source" v2-blocker-http-frontend-url \
  'https://\*)' \
  'http://*)'

# 5b) missing FRONTEND_URL acceptance
make_fixture "$v2_source" v2-blocker-missing-frontend-url \
  'FRONTEND_URL' \
  'FRONTEND_ORIGIN'

# 5c) duplicate FRONTEND_URL rejection inverted in both assignment orders.
# Both remove the count!=1 terminal rejection while leaving https:// scheme check intact.
# Order annotations document HTTPS→HTTP and HTTP→HTTPS; uniqueness failure is order-independent.
python3 - "$v2_source" "$fixture_dir" <<'PYDUP'
from pathlib import Path
import sys
src = Path(sys.argv[1]).read_text()
out_dir = Path(sys.argv[2])

# Remove the terminal uniqueness rejection body (exit 3), keep count==0 missing path.
old = """      if (count != 1) {
        exit 3
      }
"""
if old not in src:
    raise SystemExit('FRONTEND_URL uniqueness block not found')

# HTTPS then HTTP: uniqueness inverted; first-value wins semantics implied.
https_http = src.replace(
    old,
    """      if (count != 1) {
        # uniqueness inverted (order: HTTPS then HTTP) — extras ignored, no terminal reject
      }
""",
    1,
)
# HTTP then HTTPS: same uniqueness inversion, distinct order annotation.
http_https = src.replace(
    old,
    """      if (count != 1) {
        # uniqueness inverted (order: HTTP then HTTPS) — extras ignored, no terminal reject
      }
""",
    1,
)
if https_http == src or http_https == src:
    raise SystemExit('duplicate FRONTEND_URL fixtures not distinct from source')
if https_http == http_https:
    raise SystemExit('duplicate FRONTEND_URL order fixtures not distinct from each other')
(out_dir / 'v2-blocker-duplicate-frontend-url-https-http').write_text(https_http)
(out_dir / 'v2-blocker-duplicate-frontend-url-http-https').write_text(http_https)
PYDUP

# 5d) each authoritative compose ps probe swallows nonzero status
# (avoid make_fixture/sed '|' delimiter — replacement contains '||')
python3 - "$v2_source" "$fixture_dir" <<'PYPS'
from pathlib import Path
import sys
src_path = Path(sys.argv[1])
out_dir = Path(sys.argv[2])
src = src_path.read_text()
specs = [
    (
        "v2-blocker-ps-fe-running-swallowed",
        'fe_running="$("${compose[@]}" ps -q frontend)"',
        'fe_running="$("${compose[@]}" ps -q frontend 2>/dev/null || true)"',
    ),
    (
        "v2-blocker-ps-be-running-swallowed",
        'be_running="$("${compose[@]}" ps -q backend)"',
        'be_running="$("${compose[@]}" ps -q backend 2>/dev/null || true)"',
    ),
    (
        "v2-blocker-ps-fe-all-swallowed",
        'fe_all="$("${compose[@]}" ps --all -q frontend)"',
        'fe_all="$("${compose[@]}" ps --all -q frontend 2>/dev/null || true)"',
    ),
    (
        "v2-blocker-ps-be-all-swallowed",
        'be_all="$("${compose[@]}" ps --all -q backend)"',
        'be_all="$("${compose[@]}" ps --all -q backend 2>/dev/null || true)"',
    ),
]
for name, old, new in specs:
    if old not in src:
        raise SystemExit(f"ps fixture pattern missing: {name}: {old!r}")
    out = src.replace(old, new, 1)
    if out == src:
        raise SystemExit(f"ps fixture not distinct: {name}")
    (out_dir / name).write_text(out)
PYPS

# 5e) docker image inventory fail-open via unchecked process substitution
python3 - "$v2_source" "$fixture_dir/v2-blocker-image-inventory-fail-open" <<'PYFIXTURE'
from pathlib import Path
import re
import sys
src = Path(sys.argv[1]).read_text()
pat = re.compile(
    r"# docker images 포맷:.*?\ndone < \"\$images_inventory\"\n",
    re.S,
)
repl = (
    "# docker images 포맷: repository:tag. dangling/untagged 는 스킵.\n"
    "# FAIL-OPEN mutation: unchecked process substitution swallows docker images failure\n"
    "while IFS=\"$(printf '\\t')\" read -r repo tag image_id; do\n"
    "  [ -n \"$repo\" ] || continue\n"
    "  [ -n \"$tag\" ] || continue\n"
    "  [ \"$tag\" = \"<none>\" ] && continue\n"
    "  case \"$repo\" in\n"
    "    oss-hub-frontend|oss-hub-backend) ;;\n"
    "    *) continue ;;\n"
    "  esac\n"
    "  if is_kept_tag \"$tag\"; then\n"
    "    continue\n"
    "  fi\n"
    "  # 결정적 삭제. 참조 중이면 실패 → fail-closed.\n"
    "  docker image rm \"${repo}:${tag}\"\n"
    "done < <(docker images --format '{{.Repository}}\\t{{.Tag}}\\t{{.ID}}')\n"
)
out, n = pat.subn(repl, src, count=1)
if n != 1:
    raise SystemExit(f'inventory block not replaced: n={n}')
Path(sys.argv[2]).write_text(out)
PYFIXTURE
if cmp -s "$v2_source" "$fixture_dir/v2-blocker-image-inventory-fail-open"; then
  printf 'fixture not distinct: v2-blocker-image-inventory-fail-open\n' >&2
  exit 1
fi
if ! grep -Eq 'done[[:space:]]*<[[:space:]]*<\([[:space:]]*docker[[:space:]]+images' \
  "$fixture_dir/v2-blocker-image-inventory-fail-open"; then
  printf 'fixture missing procsub: v2-blocker-image-inventory-fail-open\n' >&2
  exit 1
fi

# 6) destructive retention commands moved before smoke (not keep-tag marker arrays)
awk '
  {
    if ($0 ~ /docker[[:space:]]+image[[:space:]]+rm[[:space:]]+"/ ||
        index($0, "bash scripts/prune-deploy-backups.sh") > 0) {
      pending = pending $0 ORS
      next
    }
    buf[++n] = $0
    if (!inject_at && index($0, "pg_dump") > 0) inject_at = n
  }
  END {
    for (i = 1; i <= n; i++) {
      print buf[i]
      if (i == inject_at) printf "%s", pending
    }
  }
' "$v2_source" >"$fixture_dir/v2-blocker-retention-before-smoke"
if cmp -s "$v2_source" "$fixture_dir/v2-blocker-retention-before-smoke"; then
  printf 'fixture not distinct: v2-blocker-retention-before-smoke\n' >&2
  exit 1
fi
# sanity: destructive commands must precede smoke rollout in the fixture
rollout_ln=$(grep -nF 'up -d --no-build --wait' "$fixture_dir/v2-blocker-retention-before-smoke" | head -n1 | cut -d: -f1)
image_rm_ln=$(grep -nE 'docker[[:space:]]+image[[:space:]]+rm[[:space:]]+' "$fixture_dir/v2-blocker-retention-before-smoke" | head -n1 | cut -d: -f1)
if [[ -z "$rollout_ln" || -z "$image_rm_ln" || ! ((image_rm_ln < rollout_ln)) ]]; then
  printf 'fixture order broken: v2-blocker-retention-before-smoke (rm=%s rollout=%s)\n' "$image_rm_ln" "$rollout_ln" >&2
  exit 1
fi

# 6b) image deletion command removed entirely
make_fixture "$v2_source" v2-blocker-missing-image-rm \
  'docker image rm "${repo}:${tag}"' \
  'echo "skip image rm ${repo}:${tag}"'

# 6c) production backup pruner 호출 제거
make_fixture "$v2_source" v2-blocker-missing-backup-rm \
  'bash scripts/prune-deploy-backups.sh "$BACKUP_DIR" "$BACKUP_RETENTION_N"' \
  'echo "skip backup pruning"'

# 7) current/previous image preservation removed
make_fixture "$v2_source" v2-blocker-no-image-preserve-current \
  'retention_keep_tags+=("${IMAGE_TAG}")' \
  'retention_keep_tags+=("never-match-current")'
make_fixture "$v2_source" v2-blocker-no-image-preserve-previous \
  'retention_keep_tags+=("${PREV_TAG}")' \
  'retention_keep_tags+=("never-match-previous")'

# 8) independent per-build OCI label mutations (frontend-only / backend-only)
awk '
  BEGIN { fe=0 }
  {
    if ($0 ~ /--file apps\/frontend\/Dockerfile/) {
      fe=1
      print
      next
    }
    if (fe && $0 ~ /--label "org.opencontainers.image.version=\$\{RELEASE_TAG\}"/) {
      sub(/org.opencontainers.image.version/, "org.opencontainers.image.title")
      fe=0
    }
    if ($0 ~ /--file apps\/backend\/Dockerfile/) fe=0
    print
  }
' "$v2_source" >"$fixture_dir/v2-blocker-frontend-missing-version-label"
if cmp -s "$v2_source" "$fixture_dir/v2-blocker-frontend-missing-version-label"; then
  printf 'fixture not distinct: v2-blocker-frontend-missing-version-label\n' >&2
  exit 1
fi

awk '
  BEGIN { be=0 }
  {
    if ($0 ~ /--file apps\/backend\/Dockerfile/) {
      be=1
      print
      next
    }
    if (be && $0 ~ /--label "org.opencontainers.image.revision=\$\{RELEASE_SHA\}"/) {
      sub(/org.opencontainers.image.revision/, "org.opencontainers.image.source")
      be=0
    }
    print
  }
' "$v2_source" >"$fixture_dir/v2-blocker-backend-missing-revision-label"
if cmp -s "$v2_source" "$fixture_dir/v2-blocker-backend-missing-revision-label"; then
  printf 'fixture not distinct: v2-blocker-backend-missing-revision-label\n' >&2
  exit 1
fi

# comment-only marker spoof must not pass v2 mode
sed "s|disableConcurrentBuilds()|// disableConcurrentBuilds()|" \
  "$v2_source" >"$fixture_dir/v2-comment-spoof-concurrency"
if cmp -s "$v2_source" "$fixture_dir/v2-comment-spoof-concurrency"; then
  printf 'fixture pattern not found: v2-comment-spoof-concurrency\n' >&2
  exit 1
fi

# spoof: comment-only cmp/downgrade text must not satisfy the bounded branch
awk '
  /if \(cmp < 0\) \{/ {
    print "              // if (cmp < 0) { env.DEPLOY_NOOP = '\''true'\''; return }"
    print "            if (cmp > 0) {"
    next
  }
  { print }
' "$v2_source" >"$fixture_dir/v2-comment-spoof-downgrade"
if cmp -s "$v2_source" "$fixture_dir/v2-comment-spoof-downgrade"; then
  printf 'fixture pattern not found: v2-comment-spoof-downgrade\n' >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Adversarial: live diagnostics that only *mention* terminal tokens must fail.
# Real condition remains; executable terminal is replaced by echo/println/string.
# ---------------------------------------------------------------------------

# stopped: shell echo 'exit 2' instead of executable exit
awk '
  /\[[[:space:]]*-z[[:space:]]+"\$fe_running"[[:space:]]*\][[:space:]]*&&[[:space:]]*\[[[:space:]]*-z[[:space:]]+"\$be_running"[[:space:]]*\]/ {
    print
    while ((getline line) > 0) {
      if (line ~ /^[[:space:]]*exit[[:space:]]+[0-9]+[[:space:]]*$/) {
        print "  echo '\''exit 2'\''"
        continue
      }
      print line
      if (line ~ /^[[:space:]]*fi[[:space:]]*$/) break
    }
    next
  }
  { print }
' "$v2_source" >"$fixture_dir/v2-spoof-stopped-echo-exit"
if cmp -s "$v2_source" "$fixture_dir/v2-spoof-stopped-echo-exit"; then
  printf 'fixture not distinct: v2-spoof-stopped-echo-exit\n' >&2
  exit 1
fi
if ! grep -Fq "echo 'exit 2'" "$fixture_dir/v2-spoof-stopped-echo-exit"; then
  printf 'fixture missing echo exit spoof: v2-spoof-stopped-echo-exit\n' >&2
  exit 1
fi
if awk '
  /\[[[:space:]]*-z[[:space:]]+"\$fe_running"[[:space:]]*\][[:space:]]*&&[[:space:]]*\[[[:space:]]*-z[[:space:]]+"\$be_running"[[:space:]]*\]/ { grab=1; next }
  grab {
    if ($0 ~ /^[[:space:]]*exit[[:space:]]+[0-9]+[[:space:]]*$/) found=1
    if ($0 ~ /^[[:space:]]*fi[[:space:]]*$/) exit
  }
  END { exit found ? 0 : 1 }
' "$fixture_dir/v2-spoof-stopped-echo-exit"; then
  printf 'fixture still has executable exit: v2-spoof-stopped-echo-exit\n' >&2
  exit 1
fi

# partial: shell echo 'exit 2' instead of executable exit
awk '
  /\[[[:space:]]*-n[[:space:]]+"\$fe_all"[[:space:]]*\][[:space:]]*&&[[:space:]]*\[[[:space:]]*-z[[:space:]]+"\$be_all"[[:space:]]*\]/ {
    print
    while ((getline line) > 0) {
      if (line ~ /^[[:space:]]*exit[[:space:]]+[0-9]+[[:space:]]*$/) {
        print "  echo '\''exit 2'\''"
        continue
      }
      print line
      if (line ~ /^[[:space:]]*fi[[:space:]]*$/) break
    }
    next
  }
  { print }
' "$v2_source" >"$fixture_dir/v2-spoof-partial-echo-exit"
if cmp -s "$v2_source" "$fixture_dir/v2-spoof-partial-echo-exit"; then
  printf 'fixture not distinct: v2-spoof-partial-echo-exit\n' >&2
  exit 1
fi
if ! grep -Fq "echo 'exit 2'" "$fixture_dir/v2-spoof-partial-echo-exit"; then
  printf 'fixture missing echo exit spoof: v2-spoof-partial-echo-exit\n' >&2
  exit 1
fi

# non-running: Groovy echo "error(...)" instead of executable error(...)
awk '
  /if \(state != '\''running'\''\) \{/ {
    print
    while ((getline line) > 0) {
      if (line ~ /^[[:space:]]*error[[:space:]]*\(/) {
        print "              echo \"error(FAIL_CLOSED unexpected_probe_state: spoof)\""
        continue
      }
      print line
      if (line ~ /^[[:space:]]*\}[[:space:]]*$/) break
    }
    next
  }
  { print }
' "$v2_source" >"$fixture_dir/v2-spoof-ambiguous-echo-error"
if cmp -s "$v2_source" "$fixture_dir/v2-spoof-ambiguous-echo-error"; then
  printf 'fixture not distinct: v2-spoof-ambiguous-echo-error\n' >&2
  exit 1
fi
if ! grep -Fq 'echo "error(' "$fixture_dir/v2-spoof-ambiguous-echo-error"; then
  printf 'fixture missing echo error spoof: v2-spoof-ambiguous-echo-error\n' >&2
  exit 1
fi
if awk '
  /if \(state != '\''running'\''\) \{/ { grab=1; next }
  grab {
    if ($0 ~ /^[[:space:]]*error[[:space:]]*\(/) found=1
    if ($0 ~ /^[[:space:]]*\}[[:space:]]*$/) exit
  }
  END { exit found ? 0 : 1 }
' "$fixture_dir/v2-spoof-ambiguous-echo-error"; then
  printf 'fixture still has executable error: v2-spoof-ambiguous-echo-error\n' >&2
  exit 1
fi

# non-running: Groovy println "error(...)" variant
awk '
  /if \(state != '\''running'\''\) \{/ {
    print
    while ((getline line) > 0) {
      if (line ~ /^[[:space:]]*error[[:space:]]*\(/) {
        print "              println(\"error(FAIL_CLOSED unexpected_probe_state: spoof)\")"
        continue
      }
      print line
      if (line ~ /^[[:space:]]*\}[[:space:]]*$/) break
    }
    next
  }
  { print }
' "$v2_source" >"$fixture_dir/v2-spoof-ambiguous-println-error"
if cmp -s "$v2_source" "$fixture_dir/v2-spoof-ambiguous-println-error"; then
  printf 'fixture not distinct: v2-spoof-ambiguous-println-error\n' >&2
  exit 1
fi
if ! grep -Fq 'println("error(' "$fixture_dir/v2-spoof-ambiguous-println-error"; then
  printf 'fixture missing println error spoof: v2-spoof-ambiguous-println-error\n' >&2
  exit 1
fi

# same-tag/different-SHA: echo error(...) keeps marker text, no executable error
awk '
  /prevTag == env.RELEASE_TAG && prevSha != env.RELEASE_SHA/ {
    print
    while ((getline line) > 0) {
      if (line ~ /^[[:space:]]*error[[:space:]]*\(/) {
        print "              echo \"error(FAIL_CLOSED same_tag_different_sha: retag SHA mismatch)\""
        continue
      }
      print line
      if (line ~ /^[[:space:]]*\}[[:space:]]*$/) break
    }
    next
  }
  { print }
' "$v2_source" >"$fixture_dir/v2-spoof-same-tag-echo-error"
if cmp -s "$v2_source" "$fixture_dir/v2-spoof-same-tag-echo-error"; then
  printf 'fixture not distinct: v2-spoof-same-tag-echo-error\n' >&2
  exit 1
fi
if ! grep -Fq 'FAIL_CLOSED same_tag_different_sha' "$fixture_dir/v2-spoof-same-tag-echo-error"; then
  printf 'fixture lost diagnostic: v2-spoof-same-tag-echo-error\n' >&2
  exit 1
fi
if awk '
  /prevTag == env.RELEASE_TAG && prevSha != env.RELEASE_SHA/ { grab=1; next }
  grab {
    if ($0 ~ /^[[:space:]]*error[[:space:]]*\(/) found=1
    if ($0 ~ /^[[:space:]]*\}[[:space:]]*$/) exit
  }
  END { exit found ? 0 : 1 }
' "$fixture_dir/v2-spoof-same-tag-echo-error"; then
  printf 'fixture still has executable error: v2-spoof-same-tag-echo-error\n' >&2
  exit 1
fi

# SemVer downgrade: string-wrapped return (echo "return") keeps DEPLOY_NOOP assignment
awk '
  /if \(cmp < 0\) \{/ {
    print
    while ((getline line) > 0) {
      if (line ~ /^[[:space:]]*return[[:space:]]*;?[[:space:]]*$/) {
        print "              echo \"return\""
        continue
      }
      print line
      if (line ~ /^[[:space:]]*\}[[:space:]]*$/) break
    }
    next
  }
  { print }
' "$v2_source" >"$fixture_dir/v2-spoof-downgrade-string-return"
if cmp -s "$v2_source" "$fixture_dir/v2-spoof-downgrade-string-return"; then
  printf 'fixture not distinct: v2-spoof-downgrade-string-return\n' >&2
  exit 1
fi
if ! grep -Fq 'echo "return"' "$fixture_dir/v2-spoof-downgrade-string-return"; then
  printf 'fixture missing string return spoof: v2-spoof-downgrade-string-return\n' >&2
  exit 1
fi
if awk '
  /if \(cmp < 0\) \{/ { grab=1; next }
  grab {
    if ($0 ~ /^[[:space:]]*return[[:space:]]*;?[[:space:]]*$/) found=1
    if ($0 ~ /^[[:space:]]*\}[[:space:]]*$/) exit
  }
  END { exit found ? 0 : 1 }
' "$fixture_dir/v2-spoof-downgrade-string-return"; then
  printf 'fixture still has executable return: v2-spoof-downgrade-string-return\n' >&2
  exit 1
fi

# SemVer downgrade: string-wrapped no-op assignment; keep executable return
awk '
  /if \(cmp < 0\) \{/ {
    print
    while ((getline line) > 0) {
      if (line ~ /^[[:space:]]*(env\.)?DEPLOY_NOOP[[:space:]]*=[[:space:]]*'\''true'\''/) {
        print "              echo \"env.DEPLOY_NOOP = '\''true'\''\""
        continue
      }
      print line
      if (line ~ /^[[:space:]]*\}[[:space:]]*$/) break
    }
    next
  }
  { print }
' "$v2_source" >"$fixture_dir/v2-spoof-downgrade-string-noop"
if cmp -s "$v2_source" "$fixture_dir/v2-spoof-downgrade-string-noop"; then
  printf 'fixture not distinct: v2-spoof-downgrade-string-noop\n' >&2
  exit 1
fi
if ! grep -Fq "echo \"env.DEPLOY_NOOP = 'true'\"" "$fixture_dir/v2-spoof-downgrade-string-noop"; then
  printf 'fixture missing string noop spoof: v2-spoof-downgrade-string-noop\n' >&2
  exit 1
fi
if awk '
  /if \(cmp < 0\) \{/ { grab=1; next }
  grab {
    if ($0 ~ /^[[:space:]]*(env\.)?DEPLOY_NOOP[[:space:]]*=[[:space:]]*'\''true'\''/) found=1
    if ($0 ~ /^[[:space:]]*\}[[:space:]]*$/) exit
  }
  END { exit found ? 0 : 1 }
' "$fixture_dir/v2-spoof-downgrade-string-noop"; then
  printf 'fixture still has executable DEPLOY_NOOP: v2-spoof-downgrade-string-noop\n' >&2
  exit 1
fi

# FRONTEND_URL missing path: replace executable exit 2 with echo 'exit 2'
awk '
  /count[[:space:]]*==[[:space:]]*0/ {
    print
    while ((getline line) > 0) {
      if (line ~ /^[[:space:]]*exit[[:space:]]+2[[:space:]]*$/) {
        print "        echo '\''exit 2'\''"
        continue
      }
      print line
      # leave the block after uniqueness exit 3 still real — only spoof exit 2
      if (line ~ /^[[:space:]]*\}[[:space:]]*$/ && seen_close++) break
    }
    next
  }
  { print }
' "$v2_source" >"$fixture_dir/v2-spoof-frontend-url-echo-exit2"
if cmp -s "$v2_source" "$fixture_dir/v2-spoof-frontend-url-echo-exit2"; then
  printf 'fixture not distinct: v2-spoof-frontend-url-echo-exit2\n' >&2
  exit 1
fi
if ! grep -Fq "echo 'exit 2'" "$fixture_dir/v2-spoof-frontend-url-echo-exit2"; then
  printf 'fixture missing echo exit 2 spoof: v2-spoof-frontend-url-echo-exit2\n' >&2
  exit 1
fi
# ensure no remaining executable exit 2 remains in the file for the missing path
if awk '
  /count[[:space:]]*==[[:space:]]*0/ { grab=1; next }
  grab {
    if ($0 ~ /^[[:space:]]*exit[[:space:]]+2[[:space:]]*$/) found=1
    if ($0 ~ /count[[:space:]]*!=[[:space:]]*1/) exit
  }
  END { exit found ? 0 : 1 }
' "$fixture_dir/v2-spoof-frontend-url-echo-exit2"; then
  printf 'fixture still has executable exit 2: v2-spoof-frontend-url-echo-exit2\n' >&2
  exit 1
fi

# FRONTEND_URL uniqueness path: replace executable exit 3 with echo 'exit 3'
awk '
  /count[[:space:]]*!=[[:space:]]*1/ {
    print
    while ((getline line) > 0) {
      if (line ~ /^[[:space:]]*exit[[:space:]]+3[[:space:]]*$/) {
        print "        echo '\''exit 3'\''"
        continue
      }
      print line
      if (line ~ /^[[:space:]]*\}[[:space:]]*$/) break
    }
    next
  }
  { print }
' "$v2_source" >"$fixture_dir/v2-spoof-frontend-url-echo-exit3"
if cmp -s "$v2_source" "$fixture_dir/v2-spoof-frontend-url-echo-exit3"; then
  printf 'fixture not distinct: v2-spoof-frontend-url-echo-exit3\n' >&2
  exit 1
fi
if ! grep -Fq "echo 'exit 3'" "$fixture_dir/v2-spoof-frontend-url-echo-exit3"; then
  printf 'fixture missing echo exit 3 spoof: v2-spoof-frontend-url-echo-exit3\n' >&2
  exit 1
fi


# ---------------------------------------------------------------------------
# Adversarial: quoted/echoed/println openers and duplicate real openers.
# Real executable condition is removed or duplicated; a spoofed opener must not
# bind terminals from an unrelated branch.
# ---------------------------------------------------------------------------

# stopped: replace real opener with echo '...condition...' and keep a false branch exit
awk '
  /^[[:space:]]*if[[:space:]]+\[[[:space:]]*-z[[:space:]]+"\$fe_running"[[:space:]]*\][[:space:]]*&&[[:space:]]*\[[[:space:]]*-z[[:space:]]+"\$be_running"[[:space:]]*\][[:space:]]*;[[:space:]]*then[[:space:]]*$/ {
    print "echo '\''if [ -z \"$fe_running\" ] && [ -z \"$be_running\" ]; then'\''"
    print "if false; then"
    print "  exit 2"
    print "fi"
    # drop original branch body through fi
    while ((getline line) > 0) {
      if (line ~ /^[[:space:]]*fi[[:space:]]*$/) break
    }
    next
  }
  { print }
' "$v2_source" >"$fixture_dir/v2-spoof-stopped-echo-opener"
if cmp -s "$v2_source" "$fixture_dir/v2-spoof-stopped-echo-opener"; then
  printf 'fixture not distinct: v2-spoof-stopped-echo-opener\n' >&2
  exit 1
fi
if grep -E -q '^[[:space:]]*if[[:space:]]+\[[[:space:]]*-z[[:space:]]+"\$fe_running"' "$fixture_dir/v2-spoof-stopped-echo-opener"; then
  printf 'fixture still has real stopped opener: v2-spoof-stopped-echo-opener\n' >&2
  exit 1
fi

# stopped: duplicate real opener; second branch is no-op (exit removed in first would still pass old checker)
awk '
  /^[[:space:]]*if[[:space:]]+\[[[:space:]]*-z[[:space:]]+"\$fe_running"[[:space:]]*\][[:space:]]*&&[[:space:]]*\[[[:space:]]*-z[[:space:]]+"\$be_running"[[:space:]]*\][[:space:]]*;[[:space:]]*then[[:space:]]*$/ {
    print
    while ((getline line) > 0) {
      print line
      if (line ~ /^[[:space:]]*fi[[:space:]]*$/) break
    }
    # inject a second identical executable opener with a terminal exit
    print "if [ -z \"$fe_running\" ] && [ -z \"$be_running\" ]; then"
    print "  exit 2"
    print "fi"
    next
  }
  { print }
' "$v2_source" >"$fixture_dir/v2-spoof-stopped-duplicate-opener"
if cmp -s "$v2_source" "$fixture_dir/v2-spoof-stopped-duplicate-opener"; then
  printf 'fixture not distinct: v2-spoof-stopped-duplicate-opener\n' >&2
  exit 1
fi
stopped_openers=$(grep -E -c '^[[:space:]]*if[[:space:]]+\[[[:space:]]*-z[[:space:]]+"\$fe_running"[[:space:]]*\][[:space:]]*&&[[:space:]]*\[[[:space:]]*-z[[:space:]]+"\$be_running"[[:space:]]*\][[:space:]]*;[[:space:]]*then[[:space:]]*$' "$fixture_dir/v2-spoof-stopped-duplicate-opener" || true)
if [[ "$stopped_openers" -lt 2 ]]; then
  printf 'fixture missing duplicate stopped opener\n' >&2
  exit 1
fi

# partial: echo-wrapped opener + false branch terminal
awk '
  /^[[:space:]]*if[[:space:]]+\{[[:space:]]*\[[[:space:]]*-n[[:space:]]+"\$fe_all"[[:space:]]*\][[:space:]]*&&[[:space:]]*\[[[:space:]]*-z[[:space:]]+"\$be_all"[[:space:]]*\][[:space:]]*;[[:space:]]*\}[[:space:]]*\|\|[[:space:]]*\{[[:space:]]*\[[[:space:]]*-z[[:space:]]+"\$fe_all"[[:space:]]*\][[:space:]]*&&[[:space:]]*\[[[:space:]]*-n[[:space:]]+"\$be_all"[[:space:]]*\][[:space:]]*;[[:space:]]*\}[[:space:]]*;[[:space:]]*then[[:space:]]*$/ {
    print "echo '\''if { [ -n \"$fe_all\" ] && [ -z \"$be_all\" ]; } || { [ -z \"$fe_all\" ] && [ -n \"$be_all\" ]; }; then'\''"
    print "if false; then"
    print "  exit 2"
    print "fi"
    while ((getline line) > 0) {
      if (line ~ /^[[:space:]]*fi[[:space:]]*$/) break
    }
    next
  }
  { print }
' "$v2_source" >"$fixture_dir/v2-spoof-partial-echo-opener"
if cmp -s "$v2_source" "$fixture_dir/v2-spoof-partial-echo-opener"; then
  printf 'fixture not distinct: v2-spoof-partial-echo-opener\n' >&2
  exit 1
fi

# partial: duplicate real opener
awk '
  /^[[:space:]]*if[[:space:]]+\{[[:space:]]*\[[[:space:]]*-n[[:space:]]+"\$fe_all"[[:space:]]*\][[:space:]]*&&[[:space:]]*\[[[:space:]]*-z[[:space:]]+"\$be_all"[[:space:]]*\][[:space:]]*;[[:space:]]*\}[[:space:]]*\|\|[[:space:]]*\{[[:space:]]*\[[[:space:]]*-z[[:space:]]+"\$fe_all"[[:space:]]*\][[:space:]]*&&[[:space:]]*\[[[:space:]]*-n[[:space:]]+"\$be_all"[[:space:]]*\][[:space:]]*;[[:space:]]*\}[[:space:]]*;[[:space:]]*then[[:space:]]*$/ {
    print
    while ((getline line) > 0) {
      print line
      if (line ~ /^[[:space:]]*fi[[:space:]]*$/) break
    }
    print "if { [ -n \"$fe_all\" ] && [ -z \"$be_all\" ]; } || { [ -z \"$fe_all\" ] && [ -n \"$be_all\" ]; }; then"
    print "  exit 2"
    print "fi"
    next
  }
  { print }
' "$v2_source" >"$fixture_dir/v2-spoof-partial-duplicate-opener"
if cmp -s "$v2_source" "$fixture_dir/v2-spoof-partial-duplicate-opener"; then
  printf 'fixture not distinct: v2-spoof-partial-duplicate-opener\n' >&2
  exit 1
fi

# non-running Groovy: println-wrapped opener + unrelated error terminal
awk '
  /^[[:space:]]*if[[:space:]]*\([[:space:]]*state[[:space:]]*!=[[:space:]]*'\''running'\''[[:space:]]*\)[[:space:]]*\{[[:space:]]*$/ {
    print "              println(\"if (state != '\''running'\'') {\")"
    print "            if (false) {"
    print "              error(\"FAIL_CLOSED unexpected_probe_state: spoof\")"
    print "            }"
    while ((getline line) > 0) {
      if (line ~ /^[[:space:]]*\}[[:space:]]*$/) break
    }
    next
  }
  { print }
' "$v2_source" >"$fixture_dir/v2-spoof-ambiguous-println-opener"
if cmp -s "$v2_source" "$fixture_dir/v2-spoof-ambiguous-println-opener"; then
  printf 'fixture not distinct: v2-spoof-ambiguous-println-opener\n' >&2
  exit 1
fi

# non-running Groovy: duplicate real opener
awk '
  /^[[:space:]]*if[[:space:]]*\([[:space:]]*state[[:space:]]*!=[[:space:]]*'\''running'\''[[:space:]]*\)[[:space:]]*\{[[:space:]]*$/ {
    print
    while ((getline line) > 0) {
      print line
      if (line ~ /^[[:space:]]*\}[[:space:]]*$/) break
    }
    print "            if (state != '\''running'\'') {"
    print "              error(\"FAIL_CLOSED unexpected_probe_state: dup\")"
    print "            }"
    next
  }
  { print }
' "$v2_source" >"$fixture_dir/v2-spoof-ambiguous-duplicate-opener"
if cmp -s "$v2_source" "$fixture_dir/v2-spoof-ambiguous-duplicate-opener"; then
  printf 'fixture not distinct: v2-spoof-ambiguous-duplicate-opener\n' >&2
  exit 1
fi

# same-tag/different-SHA: echo-quoted opener + false branch error
awk '
  /^[[:space:]]*if[[:space:]]*\([[:space:]]*prevTag[[:space:]]*==[[:space:]]*env\.RELEASE_TAG[[:space:]]*&&[[:space:]]*prevSha[[:space:]]*!=[[:space:]]*env\.RELEASE_SHA[[:space:]]*\)[[:space:]]*\{[[:space:]]*$/ {
    print "              echo \"if (prevTag == env.RELEASE_TAG && prevSha != env.RELEASE_SHA) {\""
    print "            if (false) {"
    print "              error(\"FAIL_CLOSED same_tag_different_sha: spoof\")"
    print "            }"
    while ((getline line) > 0) {
      if (line ~ /^[[:space:]]*\}[[:space:]]*$/) break
    }
    next
  }
  { print }
' "$v2_source" >"$fixture_dir/v2-spoof-same-tag-echo-opener"
if cmp -s "$v2_source" "$fixture_dir/v2-spoof-same-tag-echo-opener"; then
  printf 'fixture not distinct: v2-spoof-same-tag-echo-opener\n' >&2
  exit 1
fi

# same-tag/different-SHA: duplicate real opener
awk '
  /^[[:space:]]*if[[:space:]]*\([[:space:]]*prevTag[[:space:]]*==[[:space:]]*env\.RELEASE_TAG[[:space:]]*&&[[:space:]]*prevSha[[:space:]]*!=[[:space:]]*env\.RELEASE_SHA[[:space:]]*\)[[:space:]]*\{[[:space:]]*$/ {
    print
    while ((getline line) > 0) {
      print line
      if (line ~ /^[[:space:]]*\}[[:space:]]*$/) break
    }
    print "            if (prevTag == env.RELEASE_TAG && prevSha != env.RELEASE_SHA) {"
    print "              error(\"FAIL_CLOSED same_tag_different_sha: dup\")"
    print "            }"
    next
  }
  { print }
' "$v2_source" >"$fixture_dir/v2-spoof-same-tag-duplicate-opener"
if cmp -s "$v2_source" "$fixture_dir/v2-spoof-same-tag-duplicate-opener"; then
  printf 'fixture not distinct: v2-spoof-same-tag-duplicate-opener\n' >&2
  exit 1
fi

# SemVer downgrade: echo-quoted opener + false branch with real terminals
awk '
  /^[[:space:]]*if[[:space:]]*\([[:space:]]*cmp[[:space:]]*<[[:space:]]*0[[:space:]]*\)[[:space:]]*\{[[:space:]]*$/ {
    print "              echo \"if (cmp < 0) {\""
    print "            if (false) {"
    print "              env.DEPLOY_NOOP = '\''true'\''"
    print "              return"
    print "            }"
    while ((getline line) > 0) {
      if (line ~ /^[[:space:]]*\}[[:space:]]*$/) break
    }
    next
  }
  { print }
' "$v2_source" >"$fixture_dir/v2-spoof-downgrade-echo-opener"
if cmp -s "$v2_source" "$fixture_dir/v2-spoof-downgrade-echo-opener"; then
  printf 'fixture not distinct: v2-spoof-downgrade-echo-opener\n' >&2
  exit 1
fi

# SemVer downgrade: duplicate real opener
awk '
  /^[[:space:]]*if[[:space:]]*\([[:space:]]*cmp[[:space:]]*<[[:space:]]*0[[:space:]]*\)[[:space:]]*\{[[:space:]]*$/ {
    print
    while ((getline line) > 0) {
      print line
      if (line ~ /^[[:space:]]*\}[[:space:]]*$/) break
    }
    print "            if (cmp < 0) {"
    print "              env.DEPLOY_NOOP = '\''true'\''"
    print "              return"
    print "            }"
    next
  }
  { print }
' "$v2_source" >"$fixture_dir/v2-spoof-downgrade-duplicate-opener"
if cmp -s "$v2_source" "$fixture_dir/v2-spoof-downgrade-duplicate-opener"; then
  printf 'fixture not distinct: v2-spoof-downgrade-duplicate-opener\n' >&2
  exit 1
fi

# FRONTEND_URL missing path: echo-quoted count==0 opener + false exit 2
awk '
  /^[[:space:]]*if[[:space:]]*\([[:space:]]*count[[:space:]]*==[[:space:]]*0[[:space:]]*\)[[:space:]]*\{[[:space:]]*$/ {
    print "      echo \"if (count == 0) {\""
    print "      if (false) {"
    print "        exit 2"
    print "      }"
    while ((getline line) > 0) {
      if (line ~ /^[[:space:]]*\}[[:space:]]*$/) break
    }
    next
  }
  { print }
' "$v2_source" >"$fixture_dir/v2-spoof-frontend-url-echo-opener-missing"
if cmp -s "$v2_source" "$fixture_dir/v2-spoof-frontend-url-echo-opener-missing"; then
  printf 'fixture not distinct: v2-spoof-frontend-url-echo-opener-missing\n' >&2
  exit 1
fi

# FRONTEND_URL uniqueness path: echo-quoted count!=1 opener + false exit 3
awk '
  /^[[:space:]]*if[[:space:]]*\([[:space:]]*count[[:space:]]*!=[[:space:]]*1[[:space:]]*\)[[:space:]]*\{[[:space:]]*$/ {
    print "      echo \"if (count != 1) {\""
    print "      if (false) {"
    print "        exit 3"
    print "      }"
    while ((getline line) > 0) {
      if (line ~ /^[[:space:]]*\}[[:space:]]*$/) break
    }
    next
  }
  { print }
' "$v2_source" >"$fixture_dir/v2-spoof-frontend-url-echo-opener-uniq"
if cmp -s "$v2_source" "$fixture_dir/v2-spoof-frontend-url-echo-opener-uniq"; then
  printf 'fixture not distinct: v2-spoof-frontend-url-echo-opener-uniq\n' >&2
  exit 1
fi

# FRONTEND_URL: duplicate real openers for both count branches
awk '
  /^[[:space:]]*if[[:space:]]*\([[:space:]]*count[[:space:]]*==[[:space:]]*0[[:space:]]*\)[[:space:]]*\{[[:space:]]*$/ {
    print
    while ((getline line) > 0) {
      print line
      if (line ~ /^[[:space:]]*\}[[:space:]]*$/) break
    }
    print "      if (count == 0) {"
    print "        exit 2"
    print "      }"
    next
  }
  /^[[:space:]]*if[[:space:]]*\([[:space:]]*count[[:space:]]*!=[[:space:]]*1[[:space:]]*\)[[:space:]]*\{[[:space:]]*$/ {
    print
    while ((getline line) > 0) {
      print line
      if (line ~ /^[[:space:]]*\}[[:space:]]*$/) break
    }
    print "      if (count != 1) {"
    print "        exit 3"
    print "      }"
    next
  }
  { print }
' "$v2_source" >"$fixture_dir/v2-spoof-frontend-url-duplicate-openers"
if cmp -s "$v2_source" "$fixture_dir/v2-spoof-frontend-url-duplicate-openers"; then
  printf 'fixture not distinct: v2-spoof-frontend-url-duplicate-openers\n' >&2
  exit 1
fi

expect_pass 'v2: 현재 candidate Release 배포 계약' v2 "$fixture_dir/v2-valid"
expect_pass 'v2: 기본 path 호출' v2 "$v2_source"
expect_fail 'v2: parameters 블록 부활' v2 "$fixture_dir/v2-restored-parameters"
expect_fail 'v2: DEPLOY_STATE_FILE 부활' v2 "$fixture_dir/v2-restored-deploy-state-file"
expect_fail 'v2: RELEASE_ACCEPT role=PM 부활' v2 "$fixture_dir/v2-restored-release-accept"
expect_fail 'v2: #199 Release 승인 댓글 scraping 부활' v2 "$fixture_dir/v2-restored-release-comment-scraping"
expect_fail 'v2: PM 승인 actor 파싱 부활' v2 "$fixture_dir/v2-restored-pm-actor-parsing"
expect_fail 'v2: RELEASE_ACCEPT role=TECH_LEAD 부활' v2 "$fixture_dir/v2-restored-tech-lead-accept"
expect_fail 'v2: RELEASE_OVERRIDE role=PM 부활' v2 "$fixture_dir/v2-restored-pm-override"
expect_fail 'v2: releases/latest 조회 제거' v2 "$fixture_dir/v2-missing-latest-release"
expect_fail 'v2: RUN_MODE 부활' v2 "$fixture_dir/v2-restored-run-mode"
expect_fail 'v2: 동시 배포 방지 누락' v2 "$fixture_dir/v2-missing-concurrency"
expect_fail 'v2: 전용 production executor 누락' v2 "$fixture_dir/v2-missing-production-label"
expect_fail 'v2: draft 거절 누락' v2 "$fixture_dir/v2-missing-draft-check"
expect_fail 'v2: prerelease 거절 누락' v2 "$fixture_dir/v2-missing-prerelease-check"
expect_fail 'v2: SemVer tag 검증 누락' v2 "$fixture_dir/v2-missing-tag-format"
expect_fail 'v2: sandbox 비승인 BigInteger 생성자 부활' v2 "$fixture_dir/v2-restored-big-integer"
expect_fail 'v2: Release tag SHA 해석 누락' v2 "$fixture_dir/v2-missing-tag-resolution"
expect_fail 'v2: main ancestry 검증 누락' v2 "$fixture_dir/v2-missing-main-ancestry"
expect_fail 'v2: 정확한 RELEASE_SHA checkout 누락' v2 "$fixture_dir/v2-moving-checkout"
expect_fail 'v2: IMAGE_TAG=RELEASE_TAG 계약 파손' v2 "$fixture_dir/v2-missing-image-tag-release"
expect_fail 'v2: RELEASE_SHA 바인딩 파손' v2 "$fixture_dir/v2-missing-release-sha-binding"
expect_fail 'v2: 명시적 Prisma client 생성 누락' v2 "$fixture_dir/v2-missing-prisma-generate"
expect_fail 'v2: 배포 전 test 누락' v2 "$fixture_dir/v2-missing-test"
expect_fail 'v2: migration 전 backup 누락' v2 "$fixture_dir/v2-missing-backup"
expect_fail 'v2: Prisma migration 누락' v2 "$fixture_dir/v2-missing-migration"
expect_fail 'v2: Compose 교체의 --no-build 누락' v2 "$fixture_dir/v2-missing-no-build"
expect_fail 'v2: greenfield rollback skip guard 누락' v2 "$fixture_dir/v2-missing-rollback-guard"
expect_fail 'v2: 운영 환경 credential 주입 누락' v2 "$fixture_dir/v2-missing-production-credential"
expect_fail 'v2: 실행 중 ps -q 권위 누락' v2 "$fixture_dir/v2-missing-running-ps-q"
expect_fail 'v2: 존재 분류 ps --all 누락' v2 "$fixture_dir/v2-missing-all-ps"
expect_fail 'v2: OCI version label 누락' v2 "$fixture_dir/v2-missing-oci-version-label"
expect_fail 'v2: OCI revision label 누락' v2 "$fixture_dir/v2-missing-oci-revision-label"
expect_fail 'v2: main production 자동 배포 재도입' v2 "$fixture_dir/v2-main-auto-deploy"
expect_fail 'v2: 영속 volume 파괴 명령 추가' v2 "$fixture_dir/v2-destructive-volume-removal"
expect_fail 'v2: frontend 이미지 중복 빌드' v2 "$fixture_dir/v2-duplicate-frontend-build"
expect_fail 'v2: IMAGE_TAG 재할당' v2 "$fixture_dir/v2-reassigned-image-tag"
expect_fail 'v2: shell IMAGE_TAG export' v2 "$fixture_dir/v2-exported-image-tag"
expect_fail 'v2: 추가 Docker image build' v2 "$fixture_dir/v2-extra-image-build"
expect_fail 'v2: Compose image build' v2 "$fixture_dir/v2-compose-image-build"
expect_fail 'v2: Compose up --build' v2 "$fixture_dir/v2-compose-up-build"
expect_fail 'v2: 줄 연속 Docker image build' v2 "$fixture_dir/v2-continued-image-build"
expect_fail 'v2: 줄 연속 volume 삭제' v2 "$fixture_dir/v2-continued-volume-removal"

# architecture blockers
expect_fail 'v2 blocker: SemVer downgrade cmp 조건 반전' v2 "$fixture_dir/v2-blocker-downgrade-cmp-flipped"
expect_fail 'v2 blocker: SemVer downgrade DEPLOY_NOOP 할당 파손' v2 "$fixture_dir/v2-blocker-downgrade-noop-false"
expect_fail 'v2 blocker: stopped 상태 단말 실패 제거' v2 "$fixture_dir/v2-blocker-stopped-proceeds"
expect_fail 'v2 blocker: ambiguous/non-running 단말 실패 제거' v2 "$fixture_dir/v2-blocker-ambiguous-proceeds"
expect_fail 'v2 blocker: partial 상태 단말 실패 제거' v2 "$fixture_dir/v2-blocker-partial-proceeds"
expect_fail 'v2 blocker: same-tag different-SHA fail-closed 제거' v2 "$fixture_dir/v2-blocker-same-tag-different-sha-removed"
expect_fail 'v2 blocker: rollback 외부 스크립트 호출 누락' v2 "$fixture_dir/v2-blocker-missing-rollback-script"
expect_fail 'v2 blocker: rollback 스크립트 nonzero swallow' v2 "$fixture_dir/v2-blocker-rollback-nonzero-swallowed"
expect_fail 'v2 blocker: rollback PREV_TAG withEnv 누락' v2 "$fixture_dir/v2-blocker-missing-rollback-prev-tag"
expect_fail 'v2 blocker: rollback PREV_SHA withEnv 누락' v2 "$fixture_dir/v2-blocker-missing-rollback-prev-sha"
expect_fail 'v2 blocker: rollback frontend Image ID withEnv 누락' v2 "$fixture_dir/v2-blocker-missing-rollback-prev-fe-id"
expect_fail 'v2 blocker: rollback backend Image ID withEnv 누락' v2 "$fixture_dir/v2-blocker-missing-rollback-prev-be-id"
expect_fail 'v2 blocker: HTTP FRONTEND_URL 허용' v2 "$fixture_dir/v2-blocker-http-frontend-url"
expect_fail 'v2 blocker: FRONTEND_URL 누락 허용' v2 "$fixture_dir/v2-blocker-missing-frontend-url"
expect_fail 'v2 blocker: 중복 FRONTEND_URL (HTTPS→HTTP) 허용' v2 "$fixture_dir/v2-blocker-duplicate-frontend-url-https-http"
expect_fail 'v2 blocker: 중복 FRONTEND_URL (HTTP→HTTPS) 허용' v2 "$fixture_dir/v2-blocker-duplicate-frontend-url-http-https"
expect_fail 'v2 blocker: ps -q frontend nonzero swallow' v2 "$fixture_dir/v2-blocker-ps-fe-running-swallowed"
expect_fail 'v2 blocker: ps -q backend nonzero swallow' v2 "$fixture_dir/v2-blocker-ps-be-running-swallowed"
expect_fail 'v2 blocker: ps --all -q frontend nonzero swallow' v2 "$fixture_dir/v2-blocker-ps-fe-all-swallowed"
expect_fail 'v2 blocker: ps --all -q backend nonzero swallow' v2 "$fixture_dir/v2-blocker-ps-be-all-swallowed"
expect_fail 'v2 blocker: docker images inventory producer fail-open' v2 "$fixture_dir/v2-blocker-image-inventory-fail-open"
expect_fail 'v2 blocker: destructive retention이 smoke 이전으로 이동' v2 "$fixture_dir/v2-blocker-retention-before-smoke"
expect_fail 'v2 blocker: docker image rm 삭제 명령 누락' v2 "$fixture_dir/v2-blocker-missing-image-rm"
expect_fail 'v2 blocker: production backup pruner 호출 누락' v2 "$fixture_dir/v2-blocker-missing-backup-rm"
expect_fail 'v2 blocker: 현재 IMAGE_TAG 보존 제거' v2 "$fixture_dir/v2-blocker-no-image-preserve-current"
expect_fail 'v2 blocker: 직전 PREV_TAG 보존 제거' v2 "$fixture_dir/v2-blocker-no-image-preserve-previous"
expect_fail 'v2 blocker: frontend build version label 단독 누락' v2 "$fixture_dir/v2-blocker-frontend-missing-version-label"
expect_fail 'v2 blocker: backend build revision label 단독 누락' v2 "$fixture_dir/v2-blocker-backend-missing-revision-label"
expect_fail 'v2: 주석만으로 concurrency marker spoof' v2 "$fixture_dir/v2-comment-spoof-concurrency"
expect_fail 'v2: 주석만으로 downgrade branch spoof' v2 "$fixture_dir/v2-comment-spoof-downgrade"
expect_fail 'v2 spoof: stopped 분기 echo exit 토큰' v2 "$fixture_dir/v2-spoof-stopped-echo-exit"
expect_fail 'v2 spoof: partial 분기 echo exit 토큰' v2 "$fixture_dir/v2-spoof-partial-echo-exit"
expect_fail 'v2 spoof: non-running echo error(...) 토큰' v2 "$fixture_dir/v2-spoof-ambiguous-echo-error"
expect_fail 'v2 spoof: non-running println error(...) 토큰' v2 "$fixture_dir/v2-spoof-ambiguous-println-error"
expect_fail 'v2 spoof: same-tag/different-SHA echo error(...) 토큰' v2 "$fixture_dir/v2-spoof-same-tag-echo-error"
expect_fail 'v2 spoof: SemVer downgrade string-wrapped return' v2 "$fixture_dir/v2-spoof-downgrade-string-return"
expect_fail 'v2 spoof: SemVer downgrade string-wrapped DEPLOY_NOOP' v2 "$fixture_dir/v2-spoof-downgrade-string-noop"
expect_fail 'v2 spoof: FRONTEND_URL missing path echo exit 2' v2 "$fixture_dir/v2-spoof-frontend-url-echo-exit2"
expect_fail 'v2 spoof: FRONTEND_URL uniqueness path echo exit 3' v2 "$fixture_dir/v2-spoof-frontend-url-echo-exit3"


expect_fail 'v2 spoof: stopped echo/quoted opener' v2 "$fixture_dir/v2-spoof-stopped-echo-opener"
expect_fail 'v2 spoof: stopped duplicate real opener' v2 "$fixture_dir/v2-spoof-stopped-duplicate-opener"
expect_fail 'v2 spoof: partial echo/quoted opener' v2 "$fixture_dir/v2-spoof-partial-echo-opener"
expect_fail 'v2 spoof: partial duplicate real opener' v2 "$fixture_dir/v2-spoof-partial-duplicate-opener"
expect_fail 'v2 spoof: non-running println/quoted opener' v2 "$fixture_dir/v2-spoof-ambiguous-println-opener"
expect_fail 'v2 spoof: non-running duplicate real opener' v2 "$fixture_dir/v2-spoof-ambiguous-duplicate-opener"
expect_fail 'v2 spoof: same-tag echo/quoted opener' v2 "$fixture_dir/v2-spoof-same-tag-echo-opener"
expect_fail 'v2 spoof: same-tag duplicate real opener' v2 "$fixture_dir/v2-spoof-same-tag-duplicate-opener"
expect_fail 'v2 spoof: SemVer downgrade echo/quoted opener' v2 "$fixture_dir/v2-spoof-downgrade-echo-opener"
expect_fail 'v2 spoof: SemVer downgrade duplicate real opener' v2 "$fixture_dir/v2-spoof-downgrade-duplicate-opener"
expect_fail 'v2 spoof: FRONTEND_URL missing echo/quoted opener' v2 "$fixture_dir/v2-spoof-frontend-url-echo-opener-missing"
expect_fail 'v2 spoof: FRONTEND_URL uniqueness echo/quoted opener' v2 "$fixture_dir/v2-spoof-frontend-url-echo-opener-uniq"
expect_fail 'v2 spoof: FRONTEND_URL duplicate real openers' v2 "$fixture_dir/v2-spoof-frontend-url-duplicate-openers"

printf '%s passed, %s failed\n' "$passed" "$failed"
((failed == 0))
