#!/usr/bin/env bash
# Sourced by activation. The stopped generation can still have committed a
# handoff before pause; only reconcile it after the old process is gone.
mail_sql() {
  "${compose[@]}" exec -T postgres sh -ec 'exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' sh "$@"
}
mail_pause() {
  mail_sql -c "UPDATE \"MailControl\" SET mode='PAUSED' WHERE id=1"
}
mail_stop() {
  local service=$1 id
  local ids
  ids="$(docker ps -aq --filter label=com.docker.compose.project=oss-hub --filter "label=com.docker.compose.service=$service")" || return
  for id in $ids; do
    docker stop -t 60 "$id" >/dev/null || return
    [[ "$(docker inspect -f '{{.State.Running}}:{{.State.Pid}}' "$id")" == false:0 ]] || return 1
  done
}
mail_activate() {
  local host
  host="$("${compose[@]}" run --rm -T --no-deps --entrypoint node mail-worker -e '
    const fs=require("node:fs"), crypto=require("node:crypto");
    const machine=fs.readFileSync("/run/oss-hub-machine-id","utf8").trim();
    if(!/^[a-f0-9]{32}$/.test(machine))process.exit(1);
    process.stdout.write(crypto.createHash("sha256").update(machine).digest("hex"));')" || return
  [[ "$host" =~ ^[a-f0-9]{64}$ ]] || return 1
  mail_sql -v host="$host" <<'SQL'
BEGIN;
SELECT id FROM "MailControl" WHERE id=1 AND mode='PAUSED' FOR UPDATE;
SELECT count(import_legacy_program_mail(id)) FROM "Notification" WHERE type='PROGRAM_MAIL_SEND' AND channel='INTERNAL';
SELECT count(import_legacy_program_mail(id)) FROM "Notification" WHERE type='PROGRAM_MAIL_SEND' AND channel='INTERNAL';
UPDATE "MailControl" SET mode='JOBS', "senderHost"=:'host' WHERE id=1 AND mode='PAUSED' AND ("senderHost" IS NULL OR "senderHost"=:'host');
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM "MailControl" WHERE id=1 AND mode='JOBS') THEN RAISE EXCEPTION 'mail host mismatch'; END IF;
END $$;
COMMIT;
SQL
}
