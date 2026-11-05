#!/usr/bin/env bash
set -Eeuo pipefail
set +x
umask 077

root="$1"
live=oss-hub-postgres-1
container="oss-hub-todo9-rehearsal-$(date +%s)-$$"
dump="$root/production.sql"
created=0
volumes_before="$root/volumes-before.txt"
volumes_after="$root/volumes-after.txt"

cleanup() {
  rc=$?
  trap - EXIT
  if [[ "$created" == 1 ]]; then
    docker rm -fv "$container" >/dev/null 2>&1 || rc=1
  fi
  rm -f "$dump"
  docker volume ls -q | LC_ALL=C sort >"$volumes_after"
  added="$(comm -13 "$volumes_before" "$volumes_after" | wc -l)"
  removed="$(comm -23 "$volumes_before" "$volumes_after" | wc -l)"
  printf 'SERVER_VOLUME_INVENTORY before=%s after=%s added=%s removed=%s before_sha256=%s after_sha256=%s\n' "$(wc -l <"$volumes_before")" "$(wc -l <"$volumes_after")" "$added" "$removed" "$(sha256sum "$volumes_before" | cut -d' ' -f1)" "$(sha256sum "$volumes_after" | cut -d' ' -f1)"
  cmp -s "$volumes_before" "$volumes_after" || rc=1
  rm -f "$volumes_before" "$volumes_after"
  remaining="$(docker ps -aq --filter "name=^/${container}$")"
  [[ -z "$remaining" && ! -e "$dump" ]] || rc=1
  printf 'SERVER_CLEANUP containers_remaining=%s volumes_created=0 dumps_remaining=%s EXIT=%s\n' \
    "$([[ -z "$remaining" ]] && printf 0 || printf 1)" \
    "$([[ ! -e "$dump" ]] && printf 0 || printf 1)" "$rc"
  exit "$rc"
}
trap cleanup EXIT
docker volume ls -q | LC_ALL=C sort >"$volumes_before"

command -v node >/dev/null
available_kb="$(df -Pk "$root" | awk 'NR==2 {print $4}')"
available_memory_kb="$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)"
[[ "$available_kb" -ge 1048576 && "$available_memory_kb" -ge 2097152 ]]
printf 'SERVER_CAPACITY available_disk_kb=%s available_memory_kb=%s\n' "$available_kb" "$available_memory_kb"

image="$(docker inspect --format '{{.Image}}' "$live")"
docker exec -e PGOPTIONS="-c default_transaction_read_only=on" "$live" sh -ec \
  'exec pg_dump --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >"$dump"
chmod 600 "$dump"
dump_bytes="$(wc -c <"$dump")"
[[ "$dump_bytes" -gt 0 && "$((available_kb * 1024))" -gt "$((dump_bytes * 3))" ]]
printf 'SERVER_DUMP bytes=%s mode=%s\n' "$dump_bytes" "$(stat -c %a "$dump")"

docker run -d --rm --name "$container" \
  --label oss-hub.program-migration.rehearsal=true \
  --network none --cpus 0.5 --memory 512m --memory-swap 512m \
  --tmpfs /var/lib/postgresql/data:rw,size=384m \
  -e POSTGRES_USER=oss_rehearsal -e POSTGRES_DB=postgres \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  --entrypoint sh "$image" -c 'exec nice -n 19 docker-entrypoint.sh postgres' >/dev/null
created=1
ready=0
for attempt in $(seq 1 60); do
  if docker exec "$container" pg_isready -U oss_rehearsal -d postgres >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
[[ "$ready" == 1 ]]
docker inspect --format \
  'SERVER_ISOLATION network={{.HostConfig.NetworkMode}} memory={{.HostConfig.Memory}} swap={{.HostConfig.MemorySwap}} nano_cpus={{.HostConfig.NanoCpus}} ports={{len .HostConfig.PortBindings}} labelled={{index .Config.Labels "oss-hub.program-migration.rehearsal"}}' \
  "$container"
volume_count="$(docker inspect --format '{{range .Mounts}}{{if eq .Type "volume"}}volume{{println}}{{end}}{{end}}' "$container" | awk '/volume/ {n++} END {print n+0}')"
[[ "$volume_count" == 0 ]]
pid="$(docker inspect --format '{{.State.Pid}}' "$container")"
[[ "$(ps -o ni= -p "$pid" | tr -d ' ')" == 19 ]]

export PM_PG_CONTAINER="$container" PM_DUMP_FILE="$dump"
nice -n 19 bash "$root/deploy/jenkins/program-migration/rehearse.sh" \
  "$root/deploy/jenkins/program-migration/team-application/prepare.json"
printf 'TEAM_SERVER_REHEARSAL_EXIT=0\n'
