#!/usr/bin/env bash
# G007 maintenance-window measurement verifier (fail-closed).
# Docs call these subcommands; runbook owns state transitions.
# Outputs are codes, booleans, digests, and G007_FINAL only — never secrets/paths of record.
set -euo pipefail

VERSION="1"
SCRIPT_NAME="check-g007-window.sh"

# Exact Compose service set for production compose.yml (order-insensitive compare).
DEFAULT_EXPECTED_SERVICES="backend,frontend,minio,minio-bucket,nginx,postgres"
HEX64='^[0-9a-f]{64}$'
HTTP_2XX='^2[0-9][0-9]$'

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

emit_blocked() {
  # Always print the gate line for final-gate; other subcommands print their own RESULT.
  printf 'G007_FINAL=BLOCKED\n'
  exit 1
}

require_cmd() {
  local c
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || die "missing required command: $c"
  done
}

is_hex64() {
  [[ "$1" =~ $HEX64 ]]
}

is_2xx() {
  [[ "$1" =~ $HTTP_2XX ]]
}

is_non_2xx() {
  local c=$1
  [[ -n "$c" && "$c" =~ ^[0-9][0-9][0-9]$ && ! "$c" =~ $HTTP_2XX ]]
}

unix_now() {
  date +%s
}

# --- container identity -------------------------------------------------------

cmd_container_identity_digest() {
  require_cmd docker openssl awk sort
  local project=${G007_COMPOSE_PROJECT:-oss-hub}
  local expected_csv=${G007_EXPECTED_SERVICES:-$DEFAULT_EXPECTED_SERVICES}
  local ids_file lines_file services_file
  ids_file=$(mktemp)
  lines_file=$(mktemp)
  services_file=$(mktemp)

  _cid_fail() {
    rm -f "$ids_file" "$lines_file" "$services_file"
    die "$@"
  }

  if ! docker ps -a --filter "label=com.docker.compose.project=${project}" -q >"$ids_file"; then
    _cid_fail "docker ps failed for project=${project}"
  fi

  if [[ ! -s "$ids_file" ]]; then
    _cid_fail "no containers for compose project=${project}"
  fi

  local id name image restart svc
  while IFS= read -r id; do
    [[ -n "$id" ]] || continue
    if ! name=$(docker inspect --format '{{.Name}}' "$id"); then
      _cid_fail "docker inspect Name failed id=${id}"
    fi
    if ! image=$(docker inspect --format '{{.Image}}' "$id"); then
      _cid_fail "docker inspect Image failed id=${id}"
    fi
    if ! restart=$(docker inspect --format '{{.RestartCount}}' "$id"); then
      _cid_fail "docker inspect RestartCount failed id=${id}"
    fi
    if ! svc=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$id"); then
      _cid_fail "docker inspect service label failed id=${id}"
    fi
    if [[ -z "$svc" || "$svc" == "<no value>" ]]; then
      _cid_fail "missing com.docker.compose.service label id=${id}"
    fi
    printf '%s|%s|%s|%s
' "$name" "$id" "$image" "$restart" >>"$lines_file"
    printf '%s
' "$svc" >>"$services_file"
  done <"$ids_file"

  local sorted_obs sorted_exp
  sorted_obs=$(sort -u "$services_file" | paste -sd, -)
  sorted_exp=$(printf '%s
' "${expected_csv//,/$'
'}" | sed '/^$/d' | sort -u | paste -sd, -)
  if [[ "$sorted_obs" != "$sorted_exp" ]]; then
    _cid_fail "compose service set mismatch observed=${sorted_obs} expected=${sorted_exp}"
  fi

  local digest
  if ! digest=$(sort "$lines_file" | openssl dgst -sha256 | awk '{print $NF}'); then
    _cid_fail "openssl dgst failed for container identity"
  fi
  digest=$(printf '%s' "$digest" | tr 'A-F' 'a-f')
  if ! is_hex64 "$digest"; then
    _cid_fail "container identity digest not 64-hex: ${digest}"
  fi

  rm -f "$ids_file" "$lines_file" "$services_file"

  printf 'CONTAINER_IDENTITY_DIGEST=%s
' "$digest"
  printf 'CONTAINER_SERVICES=%s
' "$sorted_obs"
  printf 'CONTAINER_IDENTITY_STATUS=ok
'
}

# --- backup inventory ---------------------------------------------------------

cmd_backup_inventory_digest() {
  require_cmd find openssl awk sort
  local dir=${G007_BACKUP_DIR:-}
  [[ -n "$dir" ]] || die "G007_BACKUP_DIR is required"

  if [[ ! -e "$dir" ]]; then
    die "G007_BACKUP_DIR does not exist"
  fi
  if [[ -L "$dir" ]]; then
    die "G007_BACKUP_DIR must not be a symlink"
  fi
  if [[ ! -d "$dir" ]]; then
    die "G007_BACKUP_DIR is not a directory"
  fi
  if [[ ! -r "$dir" ]]; then
    die "G007_BACKUP_DIR is not readable"
  fi

  local manifest list sorted manifest_sorted
  manifest=$(mktemp)
  list=$(mktemp)
  sorted=$(mktemp)
  manifest_sorted=$(mktemp)

  _bak_fail() {
    rm -f "$manifest" "$list" "$sorted" "$manifest_sorted"
    die "$@"
  }

  if ! find "$dir" -type f >"$list"; then
    _bak_fail "find failed under G007_BACKUP_DIR"
  fi

  if ! sort "$list" >"$sorted"; then
    _bak_fail "sort failed for backup inventory"
  fi

  local f rel sum
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    case "$f" in
      *$'
'*) _bak_fail "backup path contains newline" ;;
    esac
    if [[ -L "$f" ]]; then
      _bak_fail "backup inventory rejects symlinks: relative entry"
    fi
    if [[ ! -f "$f" || ! -r "$f" ]]; then
      _bak_fail "backup file unreadable"
    fi
    rel=${f#"$dir"/}
    rel=${rel#./}
    if [[ "$rel" == "$f" ]]; then
      rel=$(basename "$f")
    fi
    if ! sum=$(openssl dgst -sha256 "$f" | awk '{print $NF}'); then
      _bak_fail "openssl dgst failed for backup file"
    fi
    sum=$(printf '%s' "$sum" | tr 'A-F' 'a-f')
    if ! is_hex64 "$sum"; then
      _bak_fail "file content digest not 64-hex"
    fi
    printf '%s	%s
' "$rel" "$sum" >>"$manifest"
  done <"$sorted"

  if ! sort -t $'	' -k1,1 "$manifest" >"$manifest_sorted"; then
    _bak_fail "manifest sort failed"
  fi

  local digest
  if ! digest=$(openssl dgst -sha256 "$manifest_sorted" | awk '{print $NF}'); then
    _bak_fail "openssl dgst failed for backup manifest"
  fi
  digest=$(printf '%s' "$digest" | tr 'A-F' 'a-f')
  if ! is_hex64 "$digest"; then
    _bak_fail "backup inventory digest not 64-hex: ${digest}"
  fi

  rm -f "$manifest" "$list" "$sorted" "$manifest_sorted"

  printf 'BACKUP_INVENTORY_DIGEST=%s
' "$digest"
  printf 'BACKUP_INVENTORY_STATUS=ok
'
}

# --- health helpers -----------------------------------------------------------

curl_http_code() {
  # Usage: curl_http_code URL [extra curl args...]
  # Prints only the HTTP code; curl failures die.
  local url=$1
  shift || true
  local code
  if ! code=$(curl -sS --globoff -o /dev/null -w '%{http_code}' --max-time "${G007_CURL_MAX_TIME:-15}" "$@" "$url"); then
    die "curl failed for url probe"
  fi
  [[ -n "$code" ]] || die "empty http code"
  printf '%s' "$code"
}

cmd_loopback_health() {
  require_cmd curl
  local root health
  root=$(curl_http_code "http://127.0.0.1:8081/")
  health=$(curl_http_code "http://127.0.0.1:8081/api/v1/health")
  printf 'LOOPBACK_ROOT=%s\n' "$root"
  printf 'LOOPBACK_HEALTH=%s\n' "$health"
  if is_2xx "$root" && is_2xx "$health"; then
    printf 'LOOPBACK_HEALTH_STATUS=ok\n'
  else
    printf 'LOOPBACK_HEALTH_STATUS=blocked\n'
    return 1
  fi
}

cmd_tls_health() {
  require_cmd curl
  local base=${G007_TLS_BASE:-}
  [[ -n "$base" ]] || die "G007_TLS_BASE is required"
  local root health
  root=$(curl_http_code "${base}/")
  health=$(curl_http_code "${base}/api/v1/health")
  printf 'TLS_ROOT=%s\n' "$root"
  printf 'TLS_HEALTH=%s\n' "$health"
  if is_2xx "$root" && is_2xx "$health"; then
    printf 'TLS_HEALTH_STATUS=ok\n'
  else
    printf 'TLS_HEALTH_STATUS=blocked\n'
    return 1
  fi
}

# --- Jenkins snapshot ---------------------------------------------------------

jenkins_auth_args() {
  local user=${G007_JENKINS_USER:-}
  local token=${G007_JENKINS_TOKEN:-}
  [[ -n "$user" ]] || die "G007_JENKINS_USER is required"
  [[ -n "$token" ]] || die "G007_JENKINS_TOKEN is required"
  printf '%s' "-u${user}:${token}"
}

jenkins_base() {
  local base=${G007_JENKINS_BASE:-}
  [[ -n "$base" ]] || die "G007_JENKINS_BASE is required (loopback API root)"
  # strip trailing slash
  base=${base%/}
  printf '%s' "$base"
}

jenkins_job() {
  printf '%s' "${G007_JENKINS_JOB:-oss-hub-release-cd}"
}

jenkins_curl_json() {
  # jenkins_curl_json PATH_AFTER_BASE -> body on stdout; dies on curl/HTTP failure
  require_cmd curl jq
  local path=$1
  local base auth tmp code user token
  user=${G007_JENKINS_USER:-}
  token=${G007_JENKINS_TOKEN:-}
  [[ -n "$user" ]] || die "G007_JENKINS_USER is required"
  [[ -n "$token" ]] || die "G007_JENKINS_TOKEN is required"
  base=${G007_JENKINS_BASE:-}
  [[ -n "$base" ]] || die "G007_JENKINS_BASE is required (loopback API root)"
  base=${base%/}
  auth="-u${user}:${token}"
  tmp=$(mktemp)
  # shellcheck disable=SC2086
  if ! code=$(curl -sS --globoff -o "$tmp" -w '%{http_code}' --max-time "${G007_CURL_MAX_TIME:-15}" \
      $auth -H 'Accept: application/json' "${base}${path}"); then
    rm -f "$tmp"
    die "jenkins curl failed path=${path}"
  fi
  if ! is_2xx "$code"; then
    rm -f "$tmp"
    die "jenkins HTTP ${code} path=${path}"
  fi
  if ! jq -e . "$tmp" >/dev/null 2>&1; then
    rm -f "$tmp"
    die "jenkins response is not JSON path=${path}"
  fi
  cat "$tmp"
  rm -f "$tmp"
}

cmd_jenkins_snapshot() {
  require_cmd curl jq
  local job base
  job=$(jenkins_job)
  base=$(jenkins_base)

  # lastBuild number + building
  local job_json
  job_json=$(jenkins_curl_json "/job/${job}/api/json?tree=lastBuild[number,building,timestamp,duration,result],color") \
    || die "jenkins lastBuild fetch failed"

  local last_number building last_ts last_dur last_result
  last_number=$(printf '%s' "$job_json" | jq -er '.lastBuild.number // empty') \
    || die "jenkins schema: lastBuild.number missing"
  building=$(printf '%s' "$job_json" | jq -er 'if .lastBuild == null then empty elif .lastBuild.building == true then "1" elif .lastBuild.building == false then "0" else empty end') \
    || die "jenkins schema: lastBuild.building missing/invalid"
  last_ts=$(printf '%s' "$job_json" | jq -er '.lastBuild.timestamp // empty') \
    || die "jenkins schema: lastBuild.timestamp missing"
  last_dur=$(printf '%s' "$job_json" | jq -er '.lastBuild.duration // 0')
  last_result=$(printf '%s' "$job_json" | jq -er '.lastBuild.result // "null"')

  [[ "$last_number" =~ ^[0-9]+$ ]] || die "jenkins lastBuild.number not integer"
  [[ "$building" == "0" || "$building" == "1" ]] || die "jenkins building not 0/1"
  [[ "$last_ts" =~ ^[0-9]+$ ]] || die "jenkins timestamp not integer"

  # running count: builds currently building (tree limited)
  local builds_json running_count
  builds_json=$(jenkins_curl_json "/job/${job}/api/json?tree=builds[number,building]{0,20}") \
    || die "jenkins builds fetch failed"
  running_count=$(printf '%s' "$builds_json" | jq -er '[.builds[]? | select(.building == true)] | length') \
    || die "jenkins schema: builds running count parse failed"
  [[ "$running_count" =~ ^[0-9]+$ ]] || die "running_count not integer"

  # queue items for this job
  local queue_json queue_count
  queue_json=$(jenkins_curl_json "/queue/api/json?tree=items[task[name,url]]") \
    || die "jenkins queue fetch failed"
  queue_count=$(printf '%s' "$queue_json" | jq -er --arg job "$job" \
    '[.items[]? | select((.task.name // "") == $job or ((.task.url // "") | contains("/job/" + $job + "/")))] | length') \
    || die "jenkins schema: queue parse failed"
  [[ "$queue_count" =~ ^[0-9]+$ ]] || die "queue_count not integer"

  # log identity: number|timestamp|duration|result|building (no log body)
  local log_identity
  log_identity="${last_number}|${last_ts}|${last_dur}|${last_result}|${building}"

  printf 'JENKINS_LAST_BUILD_NUMBER=%s\n' "$last_number"
  printf 'JENKINS_BUILDING=%s\n' "$building"
  printf 'JENKINS_RUNNING_COUNT=%s\n' "$running_count"
  printf 'JENKINS_QUEUE_COUNT=%s\n' "$queue_count"
  printf 'JENKINS_LOG_IDENTITY=%s\n' "$log_identity"
  printf 'JENKINS_SNAPSHOT_STATUS=ok\n'
  printf 'JENKINS_CAPTURED_AT_UNIX=%s\n' "$(unix_now)"
}

# --- unauthorized trigger probe ----------------------------------------------

cmd_unauthorized_trigger_probe() {
  require_cmd curl jq
  local base_tls=${G007_TLS_BASE:-}
  local old_path=${G007_OLD_TRIGGER_PATH:-}
  local new_path=${G007_NEW_TRIGGER_PATH:-}
  [[ -n "$base_tls" ]] || die "G007_TLS_BASE is required"
  [[ -n "$old_path" ]] || die "G007_OLD_TRIGGER_PATH is required"
  [[ -n "$new_path" ]] || die "G007_NEW_TRIGGER_PATH is required"
  base_tls=${base_tls%/}

  # Snapshot before
  local before
  before=$(cmd_jenkins_snapshot) || die "jenkins snapshot before failed"
  local b_num b_run b_q b_log
  b_num=$(printf '%s\n' "$before" | awk -F= '/^JENKINS_LAST_BUILD_NUMBER=/{print $2}')
  b_run=$(printf '%s\n' "$before" | awk -F= '/^JENKINS_RUNNING_COUNT=/{print $2}')
  b_q=$(printf '%s\n' "$before" | awk -F= '/^JENKINS_QUEUE_COUNT=/{print $2}')
  b_log=$(printf '%s\n' "$before" | awk -F= '/^JENKINS_LOG_IDENTITY=/{print substr($0,index($0,"=")+1)}')

  local old_code new_code
  if ! old_code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time "${G007_CURL_MAX_TIME:-15}" \
      -X POST "${base_tls}${old_path}" \
      -H 'Content-Type: application/octet-stream' \
      --data-binary ''); then
    die "unauthorized old trigger curl failed"
  fi
  if ! new_code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time "${G007_CURL_MAX_TIME:-15}" \
      -X POST "${base_tls}${new_path}" \
      -H 'Content-Type: application/octet-stream' \
      --data-binary ''); then
    die "unauthorized new trigger curl failed"
  fi

  # Snapshot after
  local after
  after=$(cmd_jenkins_snapshot) || die "jenkins snapshot after failed"
  local a_num a_run a_q a_log
  a_num=$(printf '%s\n' "$after" | awk -F= '/^JENKINS_LAST_BUILD_NUMBER=/{print $2}')
  a_run=$(printf '%s\n' "$after" | awk -F= '/^JENKINS_RUNNING_COUNT=/{print $2}')
  a_q=$(printf '%s\n' "$after" | awk -F= '/^JENKINS_QUEUE_COUNT=/{print $2}')
  a_log=$(printf '%s\n' "$after" | awk -F= '/^JENKINS_LOG_IDENTITY=/{print substr($0,index($0,"=")+1)}')

  printf 'UNAUTH_OLD_HTTP=%s\n' "$old_code"
  printf 'UNAUTH_NEW_HTTP=%s\n' "$new_code"
  printf 'UNAUTH_DELTA_BUILD=%s\n' "$((a_num - b_num))"
  printf 'UNAUTH_DELTA_RUNNING=%s\n' "$((a_run - b_run))"
  printf 'UNAUTH_DELTA_QUEUE=%s\n' "$((a_q - b_q))"
  local log_delta=0
  [[ "$a_log" == "$b_log" ]] || log_delta=1
  printf 'UNAUTH_DELTA_LOG=%s\n' "$log_delta"

  local ok=1
  is_non_2xx "$old_code" || ok=0
  is_non_2xx "$new_code" || ok=0
  [[ "$a_num" == "$b_num" ]] || ok=0
  [[ "$a_run" == "$b_run" ]] || ok=0
  [[ "$a_q" == "$b_q" ]] || ok=0
  [[ "$log_delta" == "0" ]] || ok=0

  if [[ "$ok" == "1" ]]; then
    printf 'UNAUTH_PROBE_STATUS=ok\n'
    printf 'UNAUTH_PROBE=PASS\n'
  else
    printf 'UNAUTH_PROBE_STATUS=blocked\n'
    printf 'UNAUTH_PROBE=BLOCKED\n'
    return 1
  fi
}

# --- D6 probe -----------------------------------------------------------------

cmd_d6_probe() {
  require_cmd curl
  local url=${G007_D6_URL:-http://127.0.0.1:8081/api/v1/submission-files}
  local code
  if ! code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time "${G007_CURL_MAX_TIME:-15}" \
      -X POST "$url" \
      -H 'Accept: application/json' \
      -H 'Content-Type: application/octet-stream' \
      --data-binary 'x'); then
    die "d6 probe curl failed"
  fi
  printf 'D6_HTTP=%s\n' "$code"
  if [[ "$code" == "403" ]]; then
    printf 'D6_STATUS=ok\n'
    printf 'D6=PASS\n'
  else
    printf 'D6_STATUS=blocked\n'
    printf 'D6=BLOCKED\n'
    return 1
  fi
}

# --- C3 verify ----------------------------------------------------------------

cmd_c3_verify() {
  # Compares before/after identity digests and health strings.
  # Inputs via env:
  #   G007_C3_BEFORE_DIGEST G007_C3_AFTER_DIGEST
  #   G007_C3_BEFORE_HEALTH G007_C3_AFTER_HEALTH  (full multi-field health line)
  # Or re-measure after if G007_C3_REMEASURE=1
  local before_d=${G007_C3_BEFORE_DIGEST:-}
  local after_d=${G007_C3_AFTER_DIGEST:-}
  local before_h=${G007_C3_BEFORE_HEALTH:-}
  local after_h=${G007_C3_AFTER_HEALTH:-}

  if [[ "${G007_C3_REMEASURE:-0}" == "1" ]]; then
    after_d=$(cmd_container_identity_digest | awk -F= '/^CONTAINER_IDENTITY_DIGEST=/{print $2}')
    local lb tls
    lb=$(cmd_loopback_health | paste -sd'; -)
    tls=$(cmd_tls_health | paste -sd'; -)
    after_h="${lb};${tls}"
  fi

  [[ -n "$before_d" ]] || die "G007_C3_BEFORE_DIGEST required"
  [[ -n "$after_d" ]] || die "G007_C3_AFTER_DIGEST required"
  [[ -n "$before_h" ]] || die "G007_C3_BEFORE_HEALTH required"
  [[ -n "$after_h" ]] || die "G007_C3_AFTER_HEALTH required"
  is_hex64 "$before_d" || die "C3 before digest not 64-hex"
  is_hex64 "$after_d" || die "C3 after digest not 64-hex"

  local identity_equal=false health_unchanged=false
  [[ "$before_d" == "$after_d" ]] && identity_equal=true

  if [[ "$before_h" == "$after_h" ]] \
    && printf '%s\n' "$after_h" | grep -Eq 'LOOPBACK_ROOT=2[0-9][0-9]|root=2[0-9][0-9]' \
    && printf '%s\n' "$after_h" | grep -Eq 'LOOPBACK_HEALTH=2[0-9][0-9]|health=2[0-9][0-9]' \
    && printf '%s\n' "$after_h" | grep -Eq 'TLS_ROOT=2[0-9][0-9]|tls_root=2[0-9][0-9]' \
    && printf '%s\n' "$after_h" | grep -Eq 'TLS_HEALTH=2[0-9][0-9]|tls_health=2[0-9][0-9]'; then
    health_unchanged=true
  fi

  # Also accept compact form root=.. health=.. tls_root=.. tls_health=..
  if [[ "$identity_equal" == "true" && "$health_unchanged" != "true" ]]; then
    if [[ "$before_h" == "$after_h" ]] \
      && printf '%s\n' "$after_h" | grep -Eq 'root=2[0-9][0-9]' \
      && printf '%s\n' "$after_h" | grep -Eq 'health=2[0-9][0-9]' \
      && printf '%s\n' "$after_h" | grep -Eq 'tls_root=2[0-9][0-9]' \
      && printf '%s\n' "$after_h" | grep -Eq 'tls_health=2[0-9][0-9]'; then
      health_unchanged=true
    fi
  fi

  printf 'C3_IDENTITY_EQUAL=%s\n' "$identity_equal"
  printf 'C3_HEALTH_UNCHANGED_2XX=%s\n' "$health_unchanged"

  if [[ "$identity_equal" == "true" && "$health_unchanged" == "true" ]]; then
    printf 'C3_STATUS=ok\n'
    printf 'C3=PASS\n'
  else
    printf 'C3_STATUS=blocked\n'
    printf 'C3=BLOCKED\n'
    return 1
  fi
}

# --- C4 N=120 evidence --------------------------------------------------------

cmd_c4_verify() {
  require_cmd find
  local prune_cmd=${G007_PRUNE_CMD:-}
  local fixture_dir=${G007_C4_FIXTURE_DIR:-}
  local backup_dir=${G007_BACKUP_DIR:-}

  if [[ -z "$prune_cmd" ]]; then
    printf 'C4=BLOCKED\n'
    printf 'C4_REASON=missing_shared_pruning_surface\n'
    printf 'C4_STATUS=blocked\n'
    return 1
  fi
  [[ -n "$fixture_dir" ]] || die "G007_C4_FIXTURE_DIR required when prune surface present"
  [[ -n "$backup_dir" ]] || die "G007_BACKUP_DIR required for C4 operating inventory"

  local before after
  before=$(G007_BACKUP_DIR="$backup_dir" cmd_backup_inventory_digest | awk -F= '/^BACKUP_INVENTORY_DIGEST=/{print $2}')
  is_hex64 "$before" || die "C4 before digest invalid"

  rm -rf "$fixture_dir"
  mkdir -p "$fixture_dir"
  local i=0
  while [[ "$i" -lt 121 ]]; do
    printf 'fixture-%03d\n' "$i" >"$fixture_dir/backup-$(printf '%03d' "$i").sql"
    i=$((i + 1))
  done
  local count
  count=$(find "$fixture_dir" -type f | wc -l | tr -d ' ')
  [[ "$count" == "121" ]] || die "C4 fixture setup expected 121 files got ${count}"

  # same-code surface: only fixture dir
  if ! BACKUP_RETENTION_N=120 BACKUP_DIR="$fixture_dir" sh -c "$prune_cmd"; then
    rm -rf "$fixture_dir"
    printf 'C4=BLOCKED\n'
    printf 'C4_REASON=prune_command_failed\n'
    printf 'C4_STATUS=blocked\n'
    return 1
  fi
  count=$(find "$fixture_dir" -type f | wc -l | tr -d ' ')
  if [[ "$count" != "120" ]]; then
    rm -rf "$fixture_dir"
    printf 'C4=BLOCKED\n'
    printf 'C4_REASON=fixture_count_not_120\n'
    printf 'C4_FIXTURE_COUNT=%s\n' "$count"
    printf 'C4_STATUS=blocked\n'
    return 1
  fi

  after=$(G007_BACKUP_DIR="$backup_dir" cmd_backup_inventory_digest | awk -F= '/^BACKUP_INVENTORY_DIGEST=/{print $2}')
  is_hex64 "$after" || { rm -rf "$fixture_dir"; die "C4 after digest invalid"; }

  rm -rf "$fixture_dir"

  if [[ "$before" == "$after" ]]; then
    printf 'C4=PASS\n'
    printf 'C4_OPERATING_INVENTORY_EQUAL=true\n'
    printf 'C4_STATUS=ok\n'
  else
    printf 'C4=BLOCKED\n'
    printf 'C4_OPERATING_INVENTORY_EQUAL=false\n'
    printf 'C4_STATUS=blocked\n'
    return 1
  fi
}

# --- evidence helpers for final-gate ------------------------------------------

kv_get() {
  # kv_get FILE KEY
  local file=$1 key=$2
  local line val
  line=$(grep -E "^${key}=" "$file" 2>/dev/null | tail -n1) || true
  [[ -n "$line" ]] || return 1
  val=${line#*=}
  printf '%s' "$val"
}

require_kv() {
  local file=$1 key=$2
  local val
  if ! val=$(kv_get "$file" "$key"); then
    die "evidence missing key ${key} in $(basename "$file")"
  fi
  printf '%s' "$val"
}

require_file_fresh() {
  local file=$1 max_age=${G007_EVIDENCE_MAX_AGE_SEC:-86400}
  [[ -f "$file" ]] || die "evidence file missing: $(basename "$file")"
  local mtime now age
  # portable mtime
  if mtime=$(stat -f %m "$file" 2>/dev/null); then
    :
  elif mtime=$(stat -c %Y "$file" 2>/dev/null); then
    :
  else
    die "stat mtime failed for evidence $(basename "$file")"
  fi
  now=$(unix_now)
  age=$((now - mtime))
  if [[ "$age" -lt 0 || "$age" -gt "$max_age" ]]; then
    die "evidence stale or future-dated: $(basename "$file") age=${age}s max=${max_age}s"
  fi
  # Prefer captured_at_unix inside file when present.
  local cap
  if cap=$(kv_get "$file" "CAPTURED_AT_UNIX" 2>/dev/null || kv_get "$file" "JENKINS_CAPTURED_AT_UNIX" 2>/dev/null || true); then
    if [[ -n "$cap" ]]; then
      [[ "$cap" =~ ^[0-9]+$ ]] || die "CAPTURED_AT_UNIX not integer in $(basename "$file")"
      age=$((now - cap))
      if [[ "$age" -lt 0 || "$age" -gt "$max_age" ]]; then
        die "evidence captured_at stale: $(basename "$file") age=${age}s"
      fi
    fi
  fi
}

# --- final gate ---------------------------------------------------------------

cmd_final_gate() {
  local edir=${G007_EVIDENCE_DIR:-}
  local blocked_reason=""

  _final_block() {
    blocked_reason=$1
    if [[ -n "${2:-}" ]]; then
      printf '%s\n' "$2" >&2
    fi
    printf 'G007_FINAL_REASON=%s\n' "$blocked_reason"
    printf 'G007_FINAL=BLOCKED\n'
    return 1
  }

  [[ -n "$edir" ]] || { _final_block "missing_evidence_dir" "G007_EVIDENCE_DIR is required"; return 1; }
  [[ -d "$edir" ]] || { _final_block "evidence_dir_not_directory" "G007_EVIDENCE_DIR is not a directory"; return 1; }

  local required=(
    deploy_gate.kv
    jenkins_idle.kv
    running_tag.kv
    loopback_health.kv
    tls_health.kv
    d6.kv
    unauth_probe.kv
    auth_new_trigger.kv
    c4.kv
    fault_drill.kv
    d8_ruleset.kv
  )

  local f mtime now age max_age cap
  max_age=${G007_EVIDENCE_MAX_AGE_SEC:-86400}
  for f in "${required[@]}"; do
    if [[ ! -f "$edir/$f" ]]; then
      _final_block "evidence_missing_${f%.kv}" "evidence file missing: $f"
      return 1
    fi
    if mtime=$(stat -f %m "$edir/$f" 2>/dev/null); then
      :
    elif mtime=$(stat -c %Y "$edir/$f" 2>/dev/null); then
      :
    else
      _final_block "evidence_stat_failed_${f%.kv}" "stat mtime failed for evidence $f"
      return 1
    fi
    now=$(unix_now)
    age=$((now - mtime))
    if [[ "$age" -lt 0 || "$age" -gt "$max_age" ]]; then
      _final_block "evidence_stale_${f%.kv}" "evidence stale or future-dated: $f age=${age}s max=${max_age}s"
      return 1
    fi
    cap=$(kv_get "$edir/$f" "CAPTURED_AT_UNIX" || true)
    if [[ -z "$cap" ]]; then
      cap=$(kv_get "$edir/$f" "JENKINS_CAPTURED_AT_UNIX" || true)
    fi
    if [[ -n "$cap" ]]; then
      if [[ ! "$cap" =~ ^[0-9]+$ ]]; then
        _final_block "evidence_bad_captured_at_${f%.kv}" "CAPTURED_AT_UNIX not integer in $f"
        return 1
      fi
      age=$((now - cap))
      if [[ "$age" -lt 0 || "$age" -gt "$max_age" ]]; then
        _final_block "evidence_captured_stale_${f%.kv}" "evidence captured_at stale: $f age=${age}s"
        return 1
      fi
    fi
  done

  local gate param run q rtag ctag fault_tag lr lh tr th d6 d6s up uold unew db dr dq dl an c4 fd d8

  gate=$(kv_get "$edir/deploy_gate.kv" "DEPLOY_TRIGGER_ENABLED" || true)
  [[ "$gate" == "true" ]] || blocked_reason="${blocked_reason:-deploy_gate_not_true}"

  param=$(kv_get "$edir/jenkins_idle.kv" "JOB_PARAMETERIZED" || true)
  [[ "$param" == "false" ]] || blocked_reason="${blocked_reason:-job_parameterized}"

  run=$(kv_get "$edir/jenkins_idle.kv" "JENKINS_RUNNING_COUNT" || true)
  q=$(kv_get "$edir/jenkins_idle.kv" "JENKINS_QUEUE_COUNT" || true)
  [[ "$run" == "0" && "$q" == "0" ]] || blocked_reason="${blocked_reason:-jenkins_not_idle}"

  rtag=$(kv_get "$edir/running_tag.kv" "RUNNING_TAG" || true)
  ctag=$(kv_get "$edir/running_tag.kv" "CLEAN_TAG" || true)
  [[ -n "$rtag" && "$rtag" == "$ctag" ]] || blocked_reason="${blocked_reason:-running_tag_mismatch}"
  fault_tag=$(kv_get "$edir/running_tag.kv" "FAULT_TAG" || true)
  if [[ -n "$fault_tag" && "$rtag" == "$fault_tag" ]]; then
    blocked_reason="${blocked_reason:-running_tag_is_fault}"
  fi

  lr=$(kv_get "$edir/loopback_health.kv" "LOOPBACK_ROOT" || true)
  lh=$(kv_get "$edir/loopback_health.kv" "LOOPBACK_HEALTH" || true)
  tr=$(kv_get "$edir/tls_health.kv" "TLS_ROOT" || true)
  th=$(kv_get "$edir/tls_health.kv" "TLS_HEALTH" || true)
  if ! { is_2xx "$lr" && is_2xx "$lh" && is_2xx "$tr" && is_2xx "$th"; }; then
    blocked_reason="${blocked_reason:-health_not_2xx}"
  fi

  d6=$(kv_get "$edir/d6.kv" "D6_HTTP" || true)
  [[ "$d6" == "403" ]] || blocked_reason="${blocked_reason:-d6_not_403}"
  d6s=$(kv_get "$edir/d6.kv" "D6" || true)
  [[ "$d6s" == "PASS" ]] || blocked_reason="${blocked_reason:-d6_not_pass}"

  up=$(kv_get "$edir/unauth_probe.kv" "UNAUTH_PROBE" || true)
  [[ "$up" == "PASS" ]] || blocked_reason="${blocked_reason:-unauth_probe_not_pass}"
  uold=$(kv_get "$edir/unauth_probe.kv" "UNAUTH_OLD_HTTP" || true)
  unew=$(kv_get "$edir/unauth_probe.kv" "UNAUTH_NEW_HTTP" || true)
  if ! { is_non_2xx "$uold" && is_non_2xx "$unew"; }; then
    blocked_reason="${blocked_reason:-unauth_http_not_non2xx}"
  fi
  db=$(kv_get "$edir/unauth_probe.kv" "UNAUTH_DELTA_BUILD" || true)
  dr=$(kv_get "$edir/unauth_probe.kv" "UNAUTH_DELTA_RUNNING" || true)
  dq=$(kv_get "$edir/unauth_probe.kv" "UNAUTH_DELTA_QUEUE" || true)
  dl=$(kv_get "$edir/unauth_probe.kv" "UNAUTH_DELTA_LOG" || true)
  [[ "$db" == "0" && "$dr" == "0" && "$dq" == "0" && "$dl" == "0" ]] || blocked_reason="${blocked_reason:-unauth_delta_nonzero}"

  an=$(kv_get "$edir/auth_new_trigger.kv" "AUTH_NEW_TRIGGER" || true)
  [[ "$an" == "PASS" ]] || blocked_reason="${blocked_reason:-auth_new_trigger_not_pass}"

  c4=$(kv_get "$edir/c4.kv" "C4" || true)
  [[ "$c4" == "PASS" ]] || blocked_reason="${blocked_reason:-c4_not_pass}"

  fd=$(kv_get "$edir/fault_drill.kv" "FAULT_DRILL" || true)
  [[ "$fd" == "PASS" ]] || blocked_reason="${blocked_reason:-fault_drill_not_pass}"

  d8=$(kv_get "$edir/d8_ruleset.kv" "RULESET_UNCHANGED" || true)
  [[ "$d8" == "true" ]] || blocked_reason="${blocked_reason:-ruleset_changed_or_unknown}"

  if [[ -n "$blocked_reason" ]]; then
    printf 'G007_FINAL_REASON=%s\n' "$blocked_reason"
    printf 'G007_FINAL=BLOCKED\n'
    return 1
  fi

  printf 'G007_FINAL=PASS\n'
}

cmd_version() {
  printf 'check-g007-window version=%s\n' "$VERSION"
}

cmd_write_evidence() {
  # Helper: write stdin KV to evidence file with CAPTURED_AT_UNIX
  local name=${1:-}
  local edir=${G007_EVIDENCE_DIR:-}
  [[ -n "$name" ]] || die "write-evidence requires name"
  [[ -n "$edir" ]] || die "G007_EVIDENCE_DIR required"
  mkdir -p "$edir"
  local out="$edir/${name}.kv"
  {
    cat
    printf 'CAPTURED_AT_UNIX=%s\n' "$(unix_now)"
  } >"$out"
  printf 'EVIDENCE_WRITTEN=%s\n' "$name"
}

usage() {
  cat <<'EOF'
usage: check-g007-window.sh <subcommand>

subcommands:
  version
  container-identity-digest
  backup-inventory-digest
  loopback-health
  tls-health
  jenkins-snapshot
  unauthorized-trigger-probe
  d6-probe
  c3-verify
  c4-verify
  final-gate
  write-evidence <name>   # reads KV lines from stdin

Environment (public-safe names only; values never logged by this script):
  G007_COMPOSE_PROJECT   default oss-hub
  G007_EXPECTED_SERVICES default backend,frontend,minio,minio-bucket,nginx,postgres
  G007_BACKUP_DIR
  G007_TLS_BASE
  G007_JENKINS_BASE      loopback API root (e.g. http://127.0.0.1:8080)
  G007_JENKINS_USER G007_JENKINS_TOKEN G007_JENKINS_JOB
  G007_OLD_TRIGGER_PATH G007_NEW_TRIGGER_PATH
  G007_D6_URL
  G007_C3_BEFORE_DIGEST G007_C3_AFTER_DIGEST
  G007_C3_BEFORE_HEALTH G007_C3_AFTER_HEALTH
  G007_PRUNE_CMD G007_C4_FIXTURE_DIR
  G007_EVIDENCE_DIR G007_EVIDENCE_MAX_AGE_SEC
EOF
}

main() {
  local cmd=${1:-}
  shift || true
  case "$cmd" in
    version) cmd_version "$@" ;;
    container-identity-digest) cmd_container_identity_digest "$@" ;;
    backup-inventory-digest) cmd_backup_inventory_digest "$@" ;;
    loopback-health) cmd_loopback_health "$@" ;;
    tls-health) cmd_tls_health "$@" ;;
    jenkins-snapshot) cmd_jenkins_snapshot "$@" ;;
    unauthorized-trigger-probe) cmd_unauthorized_trigger_probe "$@" ;;
    d6-probe) cmd_d6_probe "$@" ;;
    c3-verify) cmd_c3_verify "$@" ;;
    c4-verify) cmd_c4_verify "$@" ;;
    final-gate) cmd_final_gate "$@" ;;
    write-evidence) cmd_write_evidence "$@" ;;
    -h|--help|help|"") usage; [[ -n "$cmd" ]] || exit 2 ;;
    *) die "unknown subcommand: $cmd" ;;
  esac
}

main "$@"
