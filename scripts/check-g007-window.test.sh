#!/usr/bin/env bash
# Fail-closed fixture tests for check-g007-window.sh.
# Never contacts real Docker/Jenkins/network services — PATH shims only.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
checker="$repo_root/scripts/check-g007-window.sh"
fixture_root=$(mktemp -d "${TMPDIR:-/tmp}/g007-window.XXXXXX")
trap 'rm -rf "$fixture_root"' EXIT

passed=0
failed=0

expect_pass() {
  local name=$1
  shift
  local out rc
  set +e
  out=$("$@" 2>&1)
  rc=$?
  set -e
  if [[ $rc -eq 0 ]]; then
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  else
    printf 'not ok - %s (rc=%s)\n%s\n' "$name" "$rc" "$out" >&2
    failed=$((failed + 1))
  fi
}

expect_fail() {
  local name=$1
  shift
  local out rc
  set +e
  out=$("$@" 2>&1)
  rc=$?
  set -e
  if [[ $rc -ne 0 ]]; then
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  else
    printf 'not ok - %s (expected fail but passed)\n%s\n' "$name" "$out" >&2
    failed=$((failed + 1))
  fi
}

expect_contains() {
  local name=$1 needle=$2
  shift 2
  local out rc
  set +e
  out=$("$@" 2>&1)
  rc=$?
  set -e
  if [[ $rc -eq 0 && "$out" == *"$needle"* ]]; then
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  else
    printf 'not ok - %s (rc=%s missing %s)\n%s\n' "$name" "$rc" "$needle" "$out" >&2
    failed=$((failed + 1))
  fi
}

expect_fail_contains() {
  local name=$1 needle=$2
  shift 2
  local out rc
  set +e
  out=$("$@" 2>&1)
  rc=$?
  set -e
  if [[ $rc -ne 0 && "$out" == *"$needle"* ]]; then
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  else
    printf 'not ok - %s (rc=%s expected needle %s)\n%s\n' "$name" "$rc" "$needle" "$out" >&2
    failed=$((failed + 1))
  fi
}

make_bin() {
  local dir=$1
  mkdir -p "$dir"
}

# ---------- version ----------
expect_contains 'version prints' 'version=1' "$checker" version

# ---------- container identity ----------
cid_dir="$fixture_root/cid"
make_bin "$cid_dir/bin"

cat >"$cid_dir/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
mode=${G007_TEST_DOCKER_MODE:-ok}
case "${1:-}" in
  ps)
    if [[ "$mode" == "ps_fail" ]]; then
      echo "docker ps boom" >&2
      exit 1
    fi
    if [[ "$mode" == "ps_empty" ]]; then
      exit 0
    fi
    # emit six container ids
    printf '%s\n' c_backend c_frontend c_minio c_minio_bucket c_nginx c_postgres
    ;;
  inspect)
    id=${@: -1}
    fmt=""
    prev=""
    for a in "$@"; do
      if [[ "$prev" == "--format" ]]; then fmt=$a; fi
      prev=$a
    done
    if [[ "$mode" == "inspect_fail" && "$id" == "c_nginx" ]]; then
      echo "inspect fail" >&2
      exit 1
    fi
    svc=""
    case "$id" in
      c_backend) svc=backend; name=/oss-hub-backend-1; img=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; rc=0 ;;
      c_frontend) svc=frontend; name=/oss-hub-frontend-1; img=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb; rc=0 ;;
      c_minio) svc=minio; name=/oss-hub-minio-1; img=sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc; rc=0 ;;
      c_minio_bucket) svc=minio-bucket; name=/oss-hub-minio-bucket-1; img=sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd; rc=0 ;;
      c_nginx) svc=nginx; name=/oss-hub-nginx-1; img=sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee; rc=0 ;;
      c_postgres) svc=postgres; name=/oss-hub-postgres-1; img=sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff; rc=0 ;;
      *) echo "unknown id $id" >&2; exit 1 ;;
    esac
    if [[ "$mode" == "missing_svc" && "$id" == "c_backend" ]]; then
      svc=""
    fi
    if [[ "$mode" == "extra_svc" && "$id" == "c_backend" ]]; then
      # will still report backend but we add via second path — change service set by renaming
      svc=backend-x
    fi
    if [[ "$mode" == "restart_bump" && "$id" == "c_backend" ]]; then
      rc=3
    fi
    case "$fmt" in
      '{{.Name}}') printf '%s\n' "$name" ;;
      '{{.Image}}') printf '%s\n' "$img" ;;
      '{{.RestartCount}}') printf '%s\n' "$rc" ;;
      '{{.Id}}') printf '%s\n' "$id" ;;
      '{{index .Config.Labels "com.docker.compose.service"}}')
        if [[ -z "$svc" ]]; then printf '%s\n' "<no value>"; else printf '%s\n' "$svc"; fi
        ;;
      *)
        # combined format fallback
        printf '%s|%s|%s|%s\n' "$name" "$id" "$img" "$rc"
        ;;
    esac
    ;;
  *)
    echo "unexpected docker args: $*" >&2
    exit 2
    ;;
esac
EOF
chmod +x "$cid_dir/bin/docker"

# real openssl/awk/sort from system
export PATH="$cid_dir/bin:$PATH"

expect_contains 'container identity happy' 'CONTAINER_IDENTITY_STATUS=ok' \
  env G007_TEST_DOCKER_MODE=ok "$checker" container-identity-digest

DIGEST_A=$(G007_TEST_DOCKER_MODE=ok "$checker" container-identity-digest | awk -F= '/^CONTAINER_IDENTITY_DIGEST=/{print $2}')
[[ ${#DIGEST_A} -eq 64 ]] || { echo "digest length fail"; exit 1; }

expect_fail 'container identity docker ps fail' \
  env G007_TEST_DOCKER_MODE=ps_fail "$checker" container-identity-digest

expect_fail 'container identity empty ps' \
  env G007_TEST_DOCKER_MODE=ps_empty "$checker" container-identity-digest

expect_fail 'container identity inspect fail' \
  env G007_TEST_DOCKER_MODE=inspect_fail "$checker" container-identity-digest

expect_fail 'container identity missing service label' \
  env G007_TEST_DOCKER_MODE=missing_svc "$checker" container-identity-digest

expect_fail 'container identity service set mismatch' \
  env G007_TEST_DOCKER_MODE=extra_svc "$checker" container-identity-digest

DIGEST_B=$(G007_TEST_DOCKER_MODE=restart_bump "$checker" container-identity-digest | awk -F= '/^CONTAINER_IDENTITY_DIGEST=/{print $2}')
if [[ "$DIGEST_A" != "$DIGEST_B" ]]; then
  printf 'ok - restart count changes digest\n'
  passed=$((passed + 1))
else
  printf 'not ok - restart count should change digest\n' >&2
  failed=$((failed + 1))
fi

# ---------- backup inventory ----------
bak="$fixture_root/backup"
mkdir -p "$bak"
printf 'one\n' >"$bak/a.sql"
printf 'two\n' >"$bak/b.sql"

expect_contains 'backup inventory happy' 'BACKUP_INVENTORY_STATUS=ok' \
  env G007_BACKUP_DIR="$bak" "$checker" backup-inventory-digest

B1=$(G007_BACKUP_DIR="$bak" "$checker" backup-inventory-digest | awk -F= '/^BACKUP_INVENTORY_DIGEST=/{print $2}')
printf 'two-changed\n' >"$bak/b.sql"
B2=$(G007_BACKUP_DIR="$bak" "$checker" backup-inventory-digest | awk -F= '/^BACKUP_INVENTORY_DIGEST=/{print $2}')
if [[ "$B1" != "$B2" ]]; then
  printf 'ok - content change changes backup digest\n'
  passed=$((passed + 1))
else
  printf 'not ok - content change should change digest\n' >&2
  failed=$((failed + 1))
fi
printf 'two\n' >"$bak/b.sql"

expect_fail 'backup missing dir' \
  env G007_BACKUP_DIR="$fixture_root/no-such-dir" "$checker" backup-inventory-digest

expect_fail 'backup dir unset' \
  env -u G007_BACKUP_DIR "$checker" backup-inventory-digest

# symlink dir rejected
ln -s "$bak" "$fixture_root/backup-link"
expect_fail 'backup symlink dir rejected' \
  env G007_BACKUP_DIR="$fixture_root/backup-link" "$checker" backup-inventory-digest

# unreadable file
printf 'x\n' >"$bak/secret.sql"
chmod 000 "$bak/secret.sql"
expect_fail 'backup unreadable file' \
  env G007_BACKUP_DIR="$bak" "$checker" backup-inventory-digest
chmod 644 "$bak/secret.sql"
rm -f "$bak/secret.sql"

# find failure via PATH shim
find_fail_dir="$fixture_root/findfail/bin"
mkdir -p "$find_fail_dir"
cat >"$find_fail_dir/find" <<'EOF'
#!/usr/bin/env bash
echo "find boom" >&2
exit 1
EOF
chmod +x "$find_fail_dir/find"
expect_fail 'backup find failure propagates' \
  env PATH="$find_fail_dir:$PATH" G007_BACKUP_DIR="$bak" "$checker" backup-inventory-digest

# openssl failure on file hash
ossl_fail="$fixture_root/osslfail/bin"
mkdir -p "$ossl_fail"
cat >"$ossl_fail/openssl" <<'EOF'
#!/usr/bin/env bash
echo "openssl boom" >&2
exit 1
EOF
chmod +x "$ossl_fail/openssl"
expect_fail 'backup openssl failure propagates' \
  env PATH="$ossl_fail:$PATH" G007_BACKUP_DIR="$bak" "$checker" backup-inventory-digest

# deterministic sort: same content different creation order
bak2="$fixture_root/backup2"
mkdir -p "$bak2"
printf 'z\n' >"$bak2/z.sql"
printf 'a\n' >"$bak2/a.sql"
D1=$(G007_BACKUP_DIR="$bak2" "$checker" backup-inventory-digest | awk -F= '/^BACKUP_INVENTORY_DIGEST=/{print $2}')
rm -rf "$bak2"
mkdir -p "$bak2"
printf 'a\n' >"$bak2/a.sql"
printf 'z\n' >"$bak2/z.sql"
D2=$(G007_BACKUP_DIR="$bak2" "$checker" backup-inventory-digest | awk -F= '/^BACKUP_INVENTORY_DIGEST=/{print $2}')
if [[ "$D1" == "$D2" ]]; then
  printf 'ok - backup digest deterministic regardless of create order\n'
  passed=$((passed + 1))
else
  printf 'not ok - digest not deterministic\n' >&2
  failed=$((failed + 1))
fi

# ---------- health / d6 via curl shim ----------
curl_dir="$fixture_root/curl/bin"
mkdir -p "$curl_dir"
cat >"$curl_dir/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
mode=${G007_TEST_CURL_MODE:-ok}
# parse -w format and URL (last non-option-ish)
url=""
write_fmt=""
args=("$@")
i=0
while [[ $i -lt ${#args[@]} ]]; do
  a=${args[$i]}
  case "$a" in
    -w) i=$((i+1)); write_fmt=${args[$i]} ;;
    -o|--max-time|-X|-H|--data-binary|-u) i=$((i+1)) ;;
    http*|HTTP*) url=$a ;;
  esac
  i=$((i+1))
done

code=200
case "$mode" in
  ok)
    case "$url" in
      */submission-files*) code=403 ;;
      */health*) code=200 ;;
      */api/json*) code=200 ;;
      */queue/*) code=200 ;;
      *) code=200 ;;
    esac
    ;;
  d6_open) case "$url" in */submission-files*) code=200 ;; *) code=200 ;; esac ;;
  d6_401) case "$url" in */submission-files*) code=401 ;; *) code=200 ;; esac ;;
  health_500) code=500 ;;
  curl_fail) echo "curl fail" >&2; exit 7 ;;
  unauth_2xx)
    case "$url" in
      */buildWithParameters*|*/build) code=201 ;;
      *) code=200 ;;
    esac
    ;;
  unauth_ok)
    case "$url" in
      */buildWithParameters*|*/job/*/build|*/build) code=403 ;;
      *) code=200 ;;
    esac
    ;;
  jenkins_http_500) code=500 ;;
  jenkins_bad_json) code=200 ;;
esac

body=""
if [[ "$url" == *"/api/json"* ]]; then
  if [[ "$mode" == "jenkins_bad_json" ]]; then
    body="not-json"
  elif [[ "$url" == *"/queue/"* ]]; then
    body='{"items":[]}'
  elif [[ "$url" == *"builds[number,building]"* ]]; then
    body='{"builds":[{"number":10,"building":false}]}'
  else
    # lastBuild payload
    building=${G007_TEST_JENKINS_BUILDING:-false}
    number=${G007_TEST_JENKINS_NUMBER:-10}
    body=$(printf '{"lastBuild":{"number":%s,"building":%s,"timestamp":1700000000000,"duration":100,"result":"SUCCESS"},"color":"blue","builds":[{"number":%s,"building":%s}]}' \
      "$number" "$building" "$number" "$building")
  fi
elif [[ "$url" == *"/queue/"* ]]; then
  qn=${G007_TEST_QUEUE_EXTRA:-0}
  if [[ "$qn" == "1" ]]; then
    body='{"items":[{"task":{"name":"oss-hub-release-cd","url":"http://127.0.0.1:8080/job/oss-hub-release-cd/"}}]}'
  else
    body='{"items":[]}'
  fi
fi

# write body to -o file if present
out_file=""
i=0
while [[ $i -lt ${#args[@]} ]]; do
  if [[ "${args[$i]}" == "-o" ]]; then
    out_file=${args[$((i+1))]}
  fi
  i=$((i+1))
done
if [[ -n "$out_file" && "$out_file" != "/dev/null" ]]; then
  printf '%s' "$body" >"$out_file"
fi

if [[ "$write_fmt" == *"%{http_code}"* ]]; then
  printf '%s' "$code"
fi
exit 0
EOF
chmod +x "$curl_dir/curl"

# jq is system

export PATH="$curl_dir:$cid_dir/bin:$PATH"
if ! command -v curl | grep -F "$curl_dir" >/dev/null; then
  printf 'curl shim not first on PATH: %s\n' "$(command -v curl)" >&2
  exit 1
fi

expect_contains 'loopback health ok' 'LOOPBACK_HEALTH_STATUS=ok' \
  env G007_TEST_CURL_MODE=ok "$checker" loopback-health

expect_fail 'loopback health 500' \
  env G007_TEST_CURL_MODE=health_500 "$checker" loopback-health

expect_fail 'loopback curl fail' \
  env G007_TEST_CURL_MODE=curl_fail "$checker" loopback-health

expect_contains 'tls health ok' 'TLS_HEALTH_STATUS=ok' \
  env G007_TEST_CURL_MODE=ok G007_TLS_BASE='https://example.test' "$checker" tls-health

expect_fail 'tls base missing' \
  env -u G007_TLS_BASE G007_TEST_CURL_MODE=ok "$checker" tls-health

expect_contains 'd6 exact 403 pass' 'D6=PASS' \
  env G007_TEST_CURL_MODE=ok "$checker" d6-probe

expect_fail_contains 'd6 200 blocks' 'D6=BLOCKED' \
  env G007_TEST_CURL_MODE=d6_open "$checker" d6-probe

expect_fail_contains 'd6 401 blocks' 'D6=BLOCKED' \
  env G007_TEST_CURL_MODE=d6_401 "$checker" d6-probe

expect_fail 'd6 curl fail' \
  env G007_TEST_CURL_MODE=curl_fail "$checker" d6-probe

# ---------- jenkins snapshot ----------
export G007_JENKINS_BASE='http://127.0.0.1:8080'
export G007_JENKINS_USER='user'
export G007_JENKINS_TOKEN='token'
export G007_JENKINS_JOB='oss-hub-release-cd'

expect_contains 'jenkins snapshot happy' 'JENKINS_SNAPSHOT_STATUS=ok' \
  env G007_TEST_CURL_MODE=ok "$checker" jenkins-snapshot

expect_fail 'jenkins missing auth' \
  env -u G007_JENKINS_USER G007_TEST_CURL_MODE=ok "$checker" jenkins-snapshot

expect_fail 'jenkins http non-2xx' \
  env G007_TEST_CURL_MODE=jenkins_http_500 "$checker" jenkins-snapshot

expect_fail 'jenkins bad json' \
  env G007_TEST_CURL_MODE=jenkins_bad_json "$checker" jenkins-snapshot

# ---------- unauthorized probe ----------
export G007_TLS_BASE='https://example.test'
export G007_OLD_TRIGGER_PATH='/job/oss-hub-release-cd/buildWithParameters'
export G007_NEW_TRIGGER_PATH='/job/oss-hub-release-cd/build'

expect_contains 'unauth probe happy non-2xx delta0' 'UNAUTH_PROBE=PASS' \
  env G007_TEST_CURL_MODE=unauth_ok "$checker" unauthorized-trigger-probe

expect_fail_contains 'unauth 2xx blocks' 'UNAUTH_PROBE=BLOCKED' \
  env G007_TEST_CURL_MODE=unauth_2xx "$checker" unauthorized-trigger-probe

# delta on build number: shim returns number bump via env mid-flight is hard;
# instead use a stateful curl for delta test
state_curl="$fixture_root/statecurl/bin"
mkdir -p "$state_curl"
cat >"$state_curl/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
state_file=${G007_TEST_STATE_FILE:?}
url=""
write_fmt=""
args=("$@")
i=0
out_file=""
while [[ $i -lt ${#args[@]} ]]; do
  a=${args[$i]}
  case "$a" in
    -w) i=$((i+1)); write_fmt=${args[$i]} ;;
    -o) i=$((i+1)); out_file=${args[$i]} ;;
    --max-time|-X|-H|--data-binary|-u) i=$((i+1)) ;;
    http*) url=$a ;;
  esac
  i=$((i+1))
done
n=0
if [[ -f "$state_file" ]]; then n=$(cat "$state_file"); fi
# increment on job api lastBuild fetch after first
code=403
body=""
if [[ "$url" == *"/queue/"* ]]; then
  body='{"items":[]}'
  code=200
elif [[ "$url" == *"/api/json"* ]]; then
  code=200
  # first two job fetches (before snapshot may call 3 endpoints): use n
  # bump n each lastBuild-style call
  if [[ "$url" == *"builds[number,building]"* ]]; then
    body=$(printf '{"builds":[{"number":%s,"building":false}]}' "$n")
  elif [[ "$url" == *"/queue/"* ]]; then
    body='{"items":[]}'
  else
    # lastBuild
    body=$(printf '{"lastBuild":{"number":%s,"building":false,"timestamp":1,"duration":1,"result":"SUCCESS"},"color":"blue"}' "$n")
    n=$((n + 1))
    printf '%s' "$n" >"$state_file"
  fi
elif [[ "$url" == *build* ]]; then
  code=403
fi
if [[ -n "$out_file" && "$out_file" != /dev/null ]]; then
  printf '%s' "$body" >"$out_file"
fi
if [[ "$write_fmt" == *"%{http_code}"* ]]; then
  printf '%s' "$code"
fi
EOF
chmod +x "$state_curl/curl"
statef="$fixture_root/jstate"
printf '10' >"$statef"
expect_fail_contains 'unauth build number delta blocks' 'UNAUTH_PROBE=BLOCKED' \
  env PATH="$state_curl:$PATH" G007_TEST_STATE_FILE="$statef" \
    G007_TLS_BASE='https://example.test' \
    G007_OLD_TRIGGER_PATH='/old' G007_NEW_TRIGGER_PATH='/new' \
    G007_JENKINS_BASE='http://127.0.0.1:8080' \
    G007_JENKINS_USER=u G007_JENKINS_TOKEN=t \
    "$checker" unauthorized-trigger-probe

# ---------- C3 ----------
hex64a=$(printf 'a%.0s' {1..64})
hex64b=$(printf 'b%.0s' {1..64})
health_ok='root=200 health=200 tls_root=200 tls_health=200'
expect_contains 'c3 pass identity+health' 'C3=PASS' \
  env G007_C3_BEFORE_DIGEST="$hex64a" G007_C3_AFTER_DIGEST="$hex64a" \
      G007_C3_BEFORE_HEALTH="$health_ok" G007_C3_AFTER_HEALTH="$health_ok" \
      "$checker" c3-verify

expect_fail_contains 'c3 identity mismatch blocks' 'C3=BLOCKED' \
  env G007_C3_BEFORE_DIGEST="$hex64a" G007_C3_AFTER_DIGEST="$hex64b" \
      G007_C3_BEFORE_HEALTH="$health_ok" G007_C3_AFTER_HEALTH="$health_ok" \
      "$checker" c3-verify

expect_fail_contains 'c3 health change blocks' 'C3=BLOCKED' \
  env G007_C3_BEFORE_DIGEST="$hex64a" G007_C3_AFTER_DIGEST="$hex64a" \
      G007_C3_BEFORE_HEALTH="$health_ok" G007_C3_AFTER_HEALTH='root=500 health=200 tls_root=200 tls_health=200' \
      "$checker" c3-verify

expect_fail 'c3 invalid digest blocks' \
  env G007_C3_BEFORE_DIGEST='nope' G007_C3_AFTER_DIGEST="$hex64a" \
      G007_C3_BEFORE_HEALTH="$health_ok" G007_C3_AFTER_HEALTH="$health_ok" \
      "$checker" c3-verify

# ---------- C4 ----------
# missing prune surface
expect_fail_contains 'c4 missing prune surface' 'missing_shared_pruning_surface' \
  env -u G007_PRUNE_CMD G007_BACKUP_DIR="$bak" G007_C4_FIXTURE_DIR="$fixture_root/c4fix" \
      "$checker" c4-verify

# prune that keeps 120
prune_ok="$fixture_root/prune-ok.sh"
cat >"$prune_ok" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
dir=${BACKUP_DIR:?}
n=${BACKUP_RETENTION_N:?}
# keep newest N by name sort reverse
mapfile -t files < <(find "$dir" -type f | sort)
total=${#files[@]}
if (( total > n )); then
  remove=$((total - n))
  i=0
  while (( i < remove )); do
    rm -f "${files[$i]}"
    i=$((i + 1))
  done
fi
EOF
chmod +x "$prune_ok"

expect_contains 'c4 happy path' 'C4=PASS' \
  env G007_PRUNE_CMD="$prune_ok" G007_BACKUP_DIR="$bak" \
      G007_C4_FIXTURE_DIR="$fixture_root/c4fix" \
      "$checker" c4-verify

# prune no-op (leaves 121)
prune_bad="$fixture_root/prune-bad.sh"
cat >"$prune_bad" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$prune_bad"
expect_fail_contains 'c4 wrong retention count blocks' 'C4=BLOCKED' \
  env G007_PRUNE_CMD="$prune_bad" G007_BACKUP_DIR="$bak" \
      G007_C4_FIXTURE_DIR="$fixture_root/c4fix2" \
      "$checker" c4-verify

# operating inventory mutation during C4
prune_mut="$fixture_root/prune-mut.sh"
cat >"$prune_mut" <<EOF
#!/usr/bin/env bash
set -euo pipefail
# mutate operating backup while "pruning" fixture
echo mutated >> "$bak/a.sql"
dir=\${BACKUP_DIR:?}
n=\${BACKUP_RETENTION_N:?}
mapfile -t files < <(find "\$dir" -type f | sort)
total=\${#files[@]}
if (( total > n )); then
  remove=\$((total - n))
  i=0
  while (( i < remove )); do
    rm -f "\${files[\$i]}"
    i=\$((i + 1))
  done
fi
EOF
chmod +x "$prune_mut"
# restore a.sql first
printf 'one\n' >"$bak/a.sql"
expect_fail_contains 'c4 operating inventory drift blocks' 'C4_OPERATING_INVENTORY_EQUAL=false' \
  env G007_PRUNE_CMD="$prune_mut" G007_BACKUP_DIR="$bak" \
      G007_C4_FIXTURE_DIR="$fixture_root/c4fix3" \
      "$checker" c4-verify
printf 'one\n' >"$bak/a.sql"

# ---------- final gate ----------
ev="$fixture_root/evidence"
mkdir -p "$ev"
now=$(date +%s)

write_kv() {
  local name=$1
  shift
  {
    for line in "$@"; do
      printf '%s\n' "$line"
    done
    printf 'CAPTURED_AT_UNIX=%s\n' "$now"
  } >"$ev/${name}.kv"
}

write_kv deploy_gate 'DEPLOY_TRIGGER_ENABLED=true'
write_kv jenkins_idle 'JOB_PARAMETERIZED=false' 'JENKINS_RUNNING_COUNT=0' 'JENKINS_QUEUE_COUNT=0'
write_kv running_tag 'RUNNING_TAG=v1.2.3' 'CLEAN_TAG=v1.2.3' 'FAULT_TAG=v1.2.3-fault'
write_kv loopback_health 'LOOPBACK_ROOT=200' 'LOOPBACK_HEALTH=200'
write_kv tls_health 'TLS_ROOT=200' 'TLS_HEALTH=200'
write_kv d6 'D6_HTTP=403' 'D6=PASS'
write_kv unauth_probe 'UNAUTH_PROBE=PASS' 'UNAUTH_OLD_HTTP=403' 'UNAUTH_NEW_HTTP=403' \
  'UNAUTH_DELTA_BUILD=0' 'UNAUTH_DELTA_RUNNING=0' 'UNAUTH_DELTA_QUEUE=0' 'UNAUTH_DELTA_LOG=0'
write_kv auth_new_trigger 'AUTH_NEW_TRIGGER=PASS'
write_kv c4 'C4=PASS' 'C4_OPERATING_INVENTORY_EQUAL=true'
write_kv fault_drill 'FAULT_DRILL=PASS'
write_kv d8_ruleset 'RULESET_UNCHANGED=true'

expect_contains 'final gate all evidence pass' 'G007_FINAL=PASS' \
  env G007_EVIDENCE_DIR="$ev" "$checker" final-gate

# mutate each required assertion to BLOCKED
expect_fail_contains 'final gate gate false' 'G007_FINAL=BLOCKED' \
  env G007_EVIDENCE_DIR="$ev" bash -c "
    printf 'DEPLOY_TRIGGER_ENABLED=false\nCAPTURED_AT_UNIX=$now\n' >'$ev/deploy_gate.kv'
    '$checker' final-gate
    rc=\$?
    printf 'DEPLOY_TRIGGER_ENABLED=true\nCAPTURED_AT_UNIX=$now\n' >'$ev/deploy_gate.kv'
    exit \$rc
  "

expect_fail_contains 'final gate c4 blocked' 'G007_FINAL=BLOCKED' \
  env G007_EVIDENCE_DIR="$ev" bash -c "
    printf 'C4=BLOCKED\nC4_REASON=missing_shared_pruning_surface\nCAPTURED_AT_UNIX=$now\n' >'$ev/c4.kv'
    '$checker' final-gate
    rc=\$?
    printf 'C4=PASS\nC4_OPERATING_INVENTORY_EQUAL=true\nCAPTURED_AT_UNIX=$now\n' >'$ev/c4.kv'
    exit \$rc
  "

expect_fail_contains 'final gate d6 not 403' 'G007_FINAL=BLOCKED' \
  env G007_EVIDENCE_DIR="$ev" bash -c "
    printf 'D6_HTTP=401\nD6=BLOCKED\nCAPTURED_AT_UNIX=$now\n' >'$ev/d6.kv'
    '$checker' final-gate
    rc=\$?
    printf 'D6_HTTP=403\nD6=PASS\nCAPTURED_AT_UNIX=$now\n' >'$ev/d6.kv'
    exit \$rc
  "

expect_fail_contains 'final gate unauth delta' 'G007_FINAL=BLOCKED' \
  env G007_EVIDENCE_DIR="$ev" bash -c "
    printf 'UNAUTH_PROBE=PASS\nUNAUTH_OLD_HTTP=403\nUNAUTH_NEW_HTTP=403\nUNAUTH_DELTA_BUILD=1\nUNAUTH_DELTA_RUNNING=0\nUNAUTH_DELTA_QUEUE=0\nUNAUTH_DELTA_LOG=0\nCAPTURED_AT_UNIX=$now\n' >'$ev/unauth_probe.kv'
    '$checker' final-gate
    rc=\$?
    printf 'UNAUTH_PROBE=PASS\nUNAUTH_OLD_HTTP=403\nUNAUTH_NEW_HTTP=403\nUNAUTH_DELTA_BUILD=0\nUNAUTH_DELTA_RUNNING=0\nUNAUTH_DELTA_QUEUE=0\nUNAUTH_DELTA_LOG=0\nCAPTURED_AT_UNIX=$now\n' >'$ev/unauth_probe.kv'
    exit \$rc
  "

expect_fail_contains 'final gate missing evidence file' 'G007_FINAL=BLOCKED' \
  env G007_EVIDENCE_DIR="$ev" bash -c "
    rm -f '$ev/fault_drill.kv'
    out=\$('$checker' final-gate 2>&1); rc=\$?
    printf 'FAULT_DRILL=PASS
CAPTURED_AT_UNIX=$now
' >'$ev/fault_drill.kv'
    printf '%s
' \"\$out\"
    exit \$rc
  "


# missing evidence should die before G007_FINAL sometimes — accept either BLOCKED or die
set +e
out=$(env G007_EVIDENCE_DIR="$ev" bash -c "rm -f '$ev/d8_ruleset.kv'; '$checker' final-gate" 2>&1)
rc=$?
set -e
printf 'RULESET_UNCHANGED=true\nCAPTURED_AT_UNIX=%s\n' "$now" >"$ev/d8_ruleset.kv"
if [[ $rc -ne 0 ]]; then
  printf 'ok - final gate missing d8 evidence fails closed\n'
  passed=$((passed + 1))
else
  printf 'not ok - final gate missing d8 should fail\n%s\n' "$out" >&2
  failed=$((failed + 1))
fi

# stale evidence
old=$((now - 1000000))
printf 'DEPLOY_TRIGGER_ENABLED=true\nCAPTURED_AT_UNIX=%s\n' "$old" >"$ev/deploy_gate.kv"
expect_fail 'final gate stale evidence' \
  env G007_EVIDENCE_DIR="$ev" G007_EVIDENCE_MAX_AGE_SEC=60 "$checker" final-gate
printf 'DEPLOY_TRIGGER_ENABLED=true\nCAPTURED_AT_UNIX=%s\n' "$now" >"$ev/deploy_gate.kv"

# empty evidence dir
empty_ev="$fixture_root/empty-ev"
mkdir -p "$empty_ev"
expect_fail 'final gate empty evidence dir' \
  env G007_EVIDENCE_DIR="$empty_ev" "$checker" final-gate

# ensure no unconditional PASS without evidence
expect_fail 'final gate no env fails' \
  env -u G007_EVIDENCE_DIR "$checker" final-gate

# final gate never prints PASS and BLOCKED together on happy path
out=$(env G007_EVIDENCE_DIR="$ev" "$checker" final-gate)
if [[ "$out" == *'G007_FINAL=PASS'* && "$out" != *'G007_FINAL=BLOCKED'* ]]; then
  printf 'ok - final gate single PASS line\n'
  passed=$((passed + 1))
else
  printf 'not ok - final gate output ambiguous\n%s\n' "$out" >&2
  failed=$((failed + 1))
fi

# jenkins queue non-zero in idle evidence
expect_fail_contains 'final gate queue non-zero' 'G007_FINAL=BLOCKED' \
  env G007_EVIDENCE_DIR="$ev" bash -c "
    printf 'JOB_PARAMETERIZED=false\nJENKINS_RUNNING_COUNT=0\nJENKINS_QUEUE_COUNT=2\nCAPTURED_AT_UNIX=$now\n' >'$ev/jenkins_idle.kv'
    '$checker' final-gate
    rc=\$?
    printf 'JOB_PARAMETERIZED=false\nJENKINS_RUNNING_COUNT=0\nJENKINS_QUEUE_COUNT=0\nCAPTURED_AT_UNIX=$now\n' >'$ev/jenkins_idle.kv'
    exit \$rc
  "

# running tag is fault
expect_fail_contains 'final gate running fault tag' 'G007_FINAL=BLOCKED' \
  env G007_EVIDENCE_DIR="$ev" bash -c "
    printf 'RUNNING_TAG=v1.2.3-fault\nCLEAN_TAG=v1.2.3\nFAULT_TAG=v1.2.3-fault\nCAPTURED_AT_UNIX=$now\n' >'$ev/running_tag.kv'
    '$checker' final-gate
    rc=\$?
    printf 'RUNNING_TAG=v1.2.3\nCLEAN_TAG=v1.2.3\nFAULT_TAG=v1.2.3-fault\nCAPTURED_AT_UNIX=$now\n' >'$ev/running_tag.kv'
    exit \$rc
  "

# openssl invalid digest simulation for container: fake openssl printing short hash
short_ossl="$fixture_root/shortossl/bin"
mkdir -p "$short_ossl"
cat >"$short_ossl/openssl" <<'EOF'
#!/usr/bin/env bash
echo "SHA256(stdin)= deadbeef"
exit 0
EOF
chmod +x "$short_ossl/openssl"
expect_fail 'container digest rejects non-64-hex' \
  env PATH="$short_ossl:$cid_dir/bin:$PATH" G007_TEST_DOCKER_MODE=ok \
      "$checker" container-identity-digest

printf '%s passed, %s failed\n' "$passed" "$failed"
((failed == 0))
