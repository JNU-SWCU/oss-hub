#!/usr/bin/env bash
set -Eeuo pipefail
set +x
umask 077
action="${1:?}" run="${2:?}"
source "$run/context.sh"
nginx_config="${UC_HOST_NGINX:-/etc/nginx/conf.d/oss-hub.conf}"
previous_tag="$(jq -er .tag "$run/previous-state.json")"
previous_generation="$(jq -er .generation "$run/previous-state.json")"
verify_db=oss_hub_uc_verification
export COMPOSE_PROJECT_NAME=oss-hub

compose_for() {
  local target=$1 generation="$STAGED_KEY_GENERATION"
  export IMAGE_TAG="$RELEASE_TAG"
  if [[ "$target" == previous ]]; then generation="$previous_generation"; export IMAGE_TAG="$previous_tag"; fi
  export GITHUB_COLLECTION_APP_PRIVATE_KEY_SOURCE="$generation/collection.pem"
  export GITHUB_OPERATIONS_APP_PRIVATE_KEY_SOURCE="$generation/operations.pem"
  compose=(docker compose -p oss-hub -f "$run/$target/compose.yml" -f "$run/$target-image.json" --env-file "$run/$target.env")
}
sql() {
  local options="-c statement_timeout=60000 -c lock_timeout=5000 -c application_name=uc-maintenance"
  if [[ "$1" == "$run/sql/rollback.sql" ]]; then
    node "$run/helpers/user-consolidation-watchdog-state.mjs" rollback-allowed "$run"
    options+=" -c oss_hub.user_consolidation_rollback=FENCED"
  fi
  docker exec -i -e "PGOPTIONS=$options" "$PREV_POSTGRES_ID" sh -ec \
    'psql -X -U "$POSTGRES_USER" -d "${1:-$POSTGRES_DB}" -v ON_ERROR_STOP=1 -At' sh "${2:-}" <"$1"
}
query() {
  docker exec "$PREV_POSTGRES_ID" sh -ec \
    'PGOPTIONS="-c statement_timeout=10000 -c lock_timeout=5000 -c application_name=uc-maintenance" psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -At -c "$1"' sh "$1"
}
units() {
  local unit inventory
  inventory="$(jq -er '.writerUnits | join("\n")' "$run/rehearsal.json")"
  while IFS= read -r unit; do
    [[ -n "$unit" ]] || continue
    systemctl "$1" "$unit"
  done <<<"$inventory"
}
remove_container() {
  local ids
  ids="$(docker ps -aq --filter "name=^/$1$")"
  [[ -n "$ids" ]] || return 0
  docker inspect "$ids" | jq -e --arg run "$run" --arg image "$(jq -er .services.backend.image "$run/candidate-image.json")" \
    'length == 1 and all(.[]; .Config.Labels["oss-hub.user-consolidation.run"] == $run and .Image == $image)' >/dev/null
  docker rm -f "$ids"
}
backend_inventory() {
  local ids id containers=()
  ids="$(docker ps -aq --filter label=com.docker.compose.project=oss-hub --filter label=com.docker.compose.service=backend)"
  [[ -n "$ids" ]]
  while IFS= read -r id; do containers+=("$id"); done <<<"$ids"
  inventory="$(docker inspect "${containers[@]}")"
  backend="$(jq -er '[.[] | select(.Config.Labels["com.docker.compose.oneoff"] == "False")] |
    if length == 1 then .[0].Id else error("ordinary-backend-singleton") end' <<<"$inventory")"
}
owned_backends() {
  jq -e --arg run "$run" --arg image "$(jq -er .services.backend.image "$run/candidate-image.json")" \
    'all(.[]; .Config.Labels["com.docker.compose.project"] == "oss-hub" and
      .Config.Labels["com.docker.compose.service"] == "backend" and
      (.Config.Labels["com.docker.compose.oneoff"] == "False" or
        (.Config.Labels["com.docker.compose.oneoff"] == "True" and
         .Config.Labels["oss-hub.user-consolidation.run"] == $run and .Image == $image and
         (.Name == "/oss-hub-uc-migrate" or .Name == "/oss-hub-uc-candidate"))))' <<<"$inventory" >/dev/null
  owned="$(jq -r '.[] | select(.Config.Labels["com.docker.compose.oneoff"] == "True") | .Id' <<<"$inventory")"
}
restore_hba() {
  docker exec -u postgres "$PREV_POSTGRES_ID" sh -ec \
    'cp "$PGDATA/pg_hba.conf.uc-original" "$PGDATA/pg_hba.conf"; pg_ctl reload -D "$PGDATA"'
}
close_remote() {
  docker exec -u postgres "$PREV_POSTGRES_ID" sh -ec '
    test -f "$PGDATA/pg_hba.conf.uc-original" || cp "$PGDATA/pg_hba.conf" "$PGDATA/pg_hba.conf.uc-original"
    { printf "host all all 0.0.0.0/0 reject\nhost all all ::/0 reject\n"; cat "$PGDATA/pg_hba.conf.uc-original"; } >"$PGDATA/pg_hba.conf.uc-next"
    mv "$PGDATA/pg_hba.conf.uc-next" "$PGDATA/pg_hba.conf"
    pg_ctl reload -D "$PGDATA"'
}
migration_client() {
  compose_for candidate
  "${compose[@]}" run -T --interactive=false -d --no-deps --name oss-hub-uc-migrate --label "oss-hub.user-consolidation.run=$run" backend sleep infinity
  migration_ip="$(docker inspect oss-hub-uc-migrate | jq -er '.[0].NetworkSettings.Networks | to_entries | select(length == 1) | .[0].value.IPAddress | select(test("^[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+$"))')"
  printf '%s\n' "$migration_ip" >"$run/migration-ip"
  sync -f "$run/migration-ip"
  docker exec -u postgres "$PREV_POSTGRES_ID" sh -ec \
    '{ printf "host all all %s/32 scram-sha-256\n" "$1"; cat "$PGDATA/pg_hba.conf"; } >"$PGDATA/pg_hba.conf.uc-next"; mv "$PGDATA/pg_hba.conf.uc-next" "$PGDATA/pg_hba.conf"; pg_ctl reload -D "$PGDATA"' sh "$migration_ip"
}
open_release() {
  local target=$1
  node "$run/helpers/user-consolidation-watchdog-state.mjs" write-allowed "$run" "$target"
  compose_for "$target"
  [[ "$(docker image inspect --format '{{.Id}}' "oss-hub-backend:$IMAGE_TAG")" == "$(jq -er .services.backend.image "$run/$target-image.json")" ]]
  generation="$STAGED_KEY_GENERATION"
  [[ "$target" == candidate ]] || generation="$previous_generation"
  ln -s "$generation" "$SECRETS_DIR/current.uc-next"
  mv -Tf "$SECRETS_DIR/current.uc-next" "$SECRETS_DIR/current"
  export GITHUB_COLLECTION_APP_PRIVATE_KEY_SOURCE="$SECRETS_DIR/current/collection.pem"
  export GITHUB_OPERATIONS_APP_PRIVATE_KEY_SOURCE="$SECRETS_DIR/current/operations.pem"
  if [[ "$target" == candidate ]]; then sql "$run/sql/open.sql"; fi
  restore_hba
  "${compose[@]}" up -d --no-build --force-recreate --no-deps --wait --wait-timeout 90 backend nginx
  "${compose[@]}" exec -T --interactive=false backend curl --fail --silent --show-error http://localhost:4000/api/v1/health >/dev/null
  "${compose[@]}" exec -T --interactive=false nginx nginx -t
  "${compose[@]}" exec -T --interactive=false nginx nginx -s reload
  install -m 644 "$run/host-nginx.conf" "$nginx_config"
  nginx -t
  systemctl reload nginx
  units start
  docker exec "$PREV_POSTGRES_ID" sh -ec 'rm "$PGDATA/pg_hba.conf.uc-original"'
}

case "$action" in
  prepare)
    # Capture immutable image IDs and the actual old environment, not new credentials used for rollback.
    cmp -s "$nginx_config" "$run/expected-host-nginx.conf"
    cp "$nginx_config" "$run/host-nginx.conf"
    jq -e '.imageId | test("^sha256:[a-f0-9]{64}$")' "$run/previous-state.json" >/dev/null
    old_id="$(jq -er .imageId "$run/previous-state.json")"
    [[ "$(docker image inspect --format '{{.Id}}' "oss-hub-backend:$previous_tag")" == "$old_id" ]]
    new_id="$(docker image inspect --format '{{.Id}}' "oss-hub-backend:$RELEASE_TAG")"
    [[ "$new_id" == "$(jq -er .candidateImageId "$run/rehearsal.json")" ]]
    [[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$new_id")" == "$RELEASE_SHA" ]]
    [[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$new_id")" == "$RELEASE_TAG" ]]
    jq -n --arg image "$old_id" '{services:{backend:{image:$image}}}' >"$run/previous-image.json"
    jq -n --arg image "$new_id" '{services:{backend:{image:$image}}}' >"$run/candidate-image.json"
    backend_inventory
    owned_backends
    docker inspect "$backend" "$PREV_POSTGRES_ID" | jq -er --arg quote "'" \
      '[.[].Config.Env[] | capture("^(?<key>[^=]+)=(?<value>.*)$"; "s")] | unique_by(.key)[] |
       .key + "=" + $quote + (.value | split($quote) | join("\\" + $quote)) + $quote' >"$run/previous.env"
    [[ "$(query "SELECT count(*) FROM pg_database WHERE datname='$verify_db'")" == 0 ]]
    docker exec "$PREV_POSTGRES_ID" sh -ec 'test ! -e "$PGDATA/pg_hba.conf.uc-original"'
    for role in collection operations; do
      [[ "$(sha256sum "$previous_generation/$role.pem" | cut -d ' ' -f 1)" == "$(jq -er --arg role "$role" '.hashes[$role]' "$run/previous-keys.json")" ]]
    done
    compose_for candidate
    "${compose[@]}" pull --quiet nginx
    migration_id="$(jq -er .migrationId "$run/sql/manifest.json")"
    for artifact in preflight reconcile rollback open; do
      [[ "$(sha256sum "$run/sql/$artifact.sql" | cut -d ' ' -f 1)" == "$(jq -er --arg key "$artifact" '.sha256[$key]' "$run/sql/manifest.json")" ]]
    done
    image_hash="$("${compose[@]}" run -T --interactive=false --rm --no-deps --name oss-hub-uc-artifact backend sha256sum "prisma/migrations/$migration_id/migration.sql")"
    [[ "${image_hash%% *}" == "$(jq -er .sha256.migration "$run/sql/manifest.json")" ]]
    "${compose[@]}" run -T --interactive=false --rm --no-deps --name oss-hub-uc-capability -e OSS_HUB_MAINTENANCE=1 backend node dist/src/cli.js verify-maintenance-capability
    "${compose[@]}" run -T --interactive=false --rm --no-deps --name oss-hub-uc-nginx-check nginx nginx -t
    [[ "$(docker image inspect --format '{{.Id}}' "oss-hub-backend:$RELEASE_TAG")" == "$new_id" ]]
    ;;
  fence)
    awk '/server_name origin.jnu-oss-hub.com;/{print; print "    return 503;"; next} {print}' "$run/host-nginx.conf" >"$run/maintenance.conf"
    install -m 644 "$run/maintenance.conf" "$nginx_config"
    nginx -t
    systemctl reload nginx
    units stop
    close_remote
    # Container restart policies cannot revive writers after a host reboot.
    backend_inventory
    docker update --restart=no "$backend"
    docker stop --time 10 "$backend"
    owned_backends
    while IFS= read -r id; do
      [[ -n "$id" ]] || continue
      docker update --restart=no "$id"
      docker stop --time 10 "$id"
    done <<<"$owned"
    deadline=$((SECONDS + 10))
    while :; do
      if status="$(curl --silent --show-error --max-time 2 --output /dev/null --write-out '%{http_code}' --resolve origin.jnu-oss-hub.com:443:127.0.0.1 https://origin.jnu-oss-hub.com/api/v1/auth/github/callback)" && [[ "$status" == 503 ]]; then
        break
      fi
      if ((SECONDS >= deadline)); then
        printf 'FAIL_CLOSED maintenance-http status=%s\n' "$status" >&2
        exit 1
      fi
    done
    ;;
  drain)
    [[ "$(query "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'")" == 0 ]]
    ;;
  preflight) sql "$run/sql/preflight.sql" ;;
  backup)
    docker exec "$PREV_POSTGRES_ID" sh -ec 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' >"$run/final.dump"
    test -s "$run/final.dump"
    sync -f "$run/final.dump"
    ;;
  verify-backup)
    docker exec "$PREV_POSTGRES_ID" sh -ec 'createdb -U "$POSTGRES_USER" -T template0 "$1"' sh "$verify_db"
    docker exec -i "$PREV_POSTGRES_ID" sh -ec 'pg_restore -U "$POSTGRES_USER" -d "$1" --exit-on-error' sh "$verify_db" <"$run/final.dump"
    restored="$(docker exec "$PREV_POSTGRES_ID" sh -ec 'psql -X -U "$POSTGRES_USER" -d "$1" -At -v ON_ERROR_STOP=1 -c '"'"'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY started_at DESC,id DESC LIMIT 1'"'"'' sh "$verify_db")"
    [[ "$restored" == "$(jq -er .previousMigrationId "$run/sql/manifest.json")" ]]
    sql "$run/sql/preflight.sql" "$verify_db"
    ;;
  migrate)
    # Only this owned, idle container receives an HBA exception; no app bootstrap runs.
    migration_client
    docker exec oss-hub-uc-migrate ./node_modules/.bin/prisma migrate deploy
    remove_container oss-hub-uc-migrate
    close_remote
    ;;
  reconcile) sql "$run/sql/reconcile.sql" ;;
  verify-candidate)
    docker exec "$PREV_POSTGRES_ID" sh -ec 'dropdb -U "$POSTGRES_USER" --force "$1"; createdb -U "$POSTGRES_USER" -T "$POSTGRES_DB" "$1"' sh "$verify_db"
    # Allow only the isolated verification database, keeping the production DB fenced.
    docker exec -u postgres "$PREV_POSTGRES_ID" sh -ec \
      '{ printf "host %s all all scram-sha-256\n" "$1"; cat "$PGDATA/pg_hba.conf"; } >"$PGDATA/pg_hba.conf.uc-next"; mv "$PGDATA/pg_hba.conf.uc-next" "$PGDATA/pg_hba.conf"; pg_ctl reload -D "$PGDATA"' sh "$verify_db"
    database_url="$(node --input-type=module -e 'import{readFileSync}from"node:fs";import{parseEnv}from"node:util";const u=new URL(parseEnv(readFileSync(process.argv[1],"utf8")).DATABASE_URL);u.pathname="/"+process.argv[2];process.stdout.write(u.href)' "$run/candidate.env" "$verify_db")"
    compose_for candidate
    candidate_id="$("${compose[@]}" run -T --interactive=false -d --no-deps --name oss-hub-uc-candidate --label "oss-hub.user-consolidation.run=$run" -e OSS_HUB_MAINTENANCE=1 -e PORT=4000 -e DATABASE_URL="$database_url" backend node dist/src/main.js)"
    [[ "$candidate_id" =~ ^[a-f0-9]{64}$ ]]
    # Readiness is established in this exact isolated container before the single maintenance probe.
    timeout -k 5 60 docker exec "$candidate_id" curl --fail --silent --show-error \
      --retry 60 --retry-connrefused --retry-all-errors --retry-delay 1 --retry-max-time 50 \
      --connect-timeout 1 --max-time 2 http://127.0.0.1:4000/api/v1/health >/dev/null
    docker exec "$candidate_id" node dist/src/cli.js verify-maintenance-state
    ;;
  stop-candidate)
    remove_container oss-hub-uc-candidate
    remove_container oss-hub-uc-migrate
    docker exec "$PREV_POSTGRES_ID" sh -ec 'dropdb -U "$POSTGRES_USER" --if-exists --force "$1"' sh "$verify_db"
    ;;
  rollback)
    if [[ "$(jq -r '.migrationAttempted // false' "$run/receipt.json")" == true ]]; then
      if [[ -s "$run/migration-ip" ]]; then
        read -r migration_ip <"$run/migration-ip"
        [[ "$migration_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]
        query "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database() AND client_addr='$migration_ip'::inet AND pid<>pg_backend_pid()" >/dev/null
      fi
      source "$run/helpers/user-consolidation-watchdog-recovery.sh"
    fi
    [[ "$(query 'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY started_at DESC,id DESC LIMIT 1')" == "$(jq -er .previousMigrationId "$run/sql/manifest.json")" ]]
    ;;
  verify-previous)
    # The old image is not booted until the irreversible recovery-open decision.
    old_id="$(jq -er .imageId "$run/previous-state.json")"
    [[ "$(docker image inspect --format '{{.Id}}' "oss-hub-backend:$previous_tag")" == "$old_id" ]]
    for role in collection operations; do
      [[ "$(sha256sum "$previous_generation/$role.pem" | cut -d ' ' -f 1)" == "$(jq -er --arg role "$role" '.hashes[$role]' "$run/previous-keys.json")" ]]
    done
    ;;
  open-candidate) open_release candidate ;;
  open-previous) open_release previous ;;
  *) printf 'FAIL_CLOSED unknown host action\n' >&2; exit 2 ;;
esac
