#!/bin/sh
# Log github-ledger-verify.sql. A count mismatch prints verify_mismatch and
# still exits 0. Report-only rows never count as a mismatch.
set -eu

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
if [ -n "${LEDGER_VERIFY_SQL:-}" ]; then
  sql_file=$LEDGER_VERIFY_SQL
else
  sql_file=$script_dir/github-ledger-verify.sql
fi

if [ ! -f "$sql_file" ]; then
  printf 'ledger verify: missing %s\n' "$sql_file" >&2
  exit 1
fi

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

run_query() {
  if command -v psql >/dev/null 2>&1; then
    if [ -n "${DATABASE_URL:-}" ]; then
      psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -q -At -F "$(printf '\t')" -f "$sql_file"
      return
    fi
    psql -v ON_ERROR_STOP=1 -X -q -At -F "$(printf '\t')" -f "$sql_file"
    return
  fi
  LEDGER_VERIFY_SQL="$sql_file" node <<'NODE'
const { readFileSync } = require('node:fs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const sql = readFileSync(process.env.LEDGER_VERIFY_SQL, 'utf8').replace(/;\s*$/, '');
prisma
  .$queryRawUnsafe(sql)
  .then((rows) => {
    for (const row of rows) {
      process.stdout.write(`${row.check}\t${row.expected}\t${row.actual}\n`);
    }
    return prisma.$disconnect();
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : 'ledger verify query failed';
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
NODE
}

if ! run_query >"$tmp"; then
  exit 1
fi

if [ ! -s "$tmp" ]; then
  printf 'ledger verify: query returned no rows\n' >&2
  exit 1
fi

mismatch=0
while IFS="$(printf '\t')" read -r check expected actual extra; do
  if [ -z "$check" ]; then
    continue
  fi
  if [ -n "${extra:-}" ]; then
    printf 'ledger verify: unexpected column in %s\n' "$check" >&2
    exit 1
  fi
  printf '%s\t%s\t%s\n' "$check" "$expected" "$actual"
  case "$check" in
    history_consecutive_same_value|open_link_repo_mismatch|open_period_created_at_floor)
      printf '%s=%s\n' "$check" "$actual"
      ;;
    *)
      if [ "$expected" != "$actual" ]; then
        mismatch=1
      fi
      ;;
  esac
done <"$tmp"

if [ "$mismatch" -eq 1 ]; then
  printf 'verify_mismatch\n'
fi

exit 0
