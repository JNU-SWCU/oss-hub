import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rehearsal = readFileSync(
  new URL('./rehearse-user-phone-column.sh', import.meta.url),
  'utf8',
);

const migration = readFileSync(
  new URL(
    '../apps/backend/prisma/migrations/20260906174608_add_user_phone_canonical/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

test('rehearsal fails closed on shell errors', () => {
  assert.match(rehearsal, /^set -euo pipefail$/m);
});

test('rehearsal accepts only its two named scenarios', () => {
  assert.match(
    rehearsal,
    /\$scenario != 'migrate' && \$scenario != 'negative'/,
  );
  assert.match(
    rehearsal,
    /Usage: scripts\/rehearse-user-phone-column\.sh migrate\|negative/,
  );
});

test('rehearsal refuses non-local Docker endpoints', () => {
  assert.match(
    rehearsal,
    /\[\[ "\$effective_docker_host" == unix:\/\/\* \]\] \|\|\s*\n\s*fail 'refusing a non-local Docker endpoint; only unix:\/\/ is allowed'/,
  );
  assert.ok(
    rehearsal.includes('docker context inspect'),
    'the endpoint must be resolved from the selected context, not assumed',
  );
});

test('rehearsal never reads a caller database connection', () => {
  assert.ok(!rehearsal.includes('DATABASE_URL'));
  assert.ok(!rehearsal.includes('POSTGRES_HOST'));

  assert.ok(
    !/docker[^\n]*\b-p\s/.test(rehearsal),
    'the rehearsal container must not publish a host port',
  );
});

test('rehearsal initializes disposable paths before the EXIT trap', () => {
  const trap = rehearsal.indexOf('trap cleanup EXIT');
  assert.ok(trap >= 0, 'the cleanup trap must exist');
  for (const name of ["tmp_root=''", "backup=''", 'container_started=0']) {
    const init = rehearsal.indexOf(name);
    assert.ok(init >= 0, `${name} must start empty so set -u cleanup is safe`);
    assert.ok(
      trap > init,
      `${name} must be initialized before trap cleanup EXIT`,
    );
  }
});

test('rehearsal cleanup removes the container with its volume and the tmp tree', () => {
  assert.match(rehearsal, /docker_cli\[@\]\}" rm -f -v "\$container"/);
  assert.match(
    rehearsal,
    /mktemp -d "\$\{TMPDIR:-\/tmp\}\/user-phone-rehearsal\.XXXXXX"/,
  );
  assert.match(rehearsal, /rm -rf -- "\$tmp_root"/);
});

test('cleanup failure fails the rehearsal even when assertions passed', () => {
  assert.match(
    rehearsal,
    /if \(\( cleanup_status != 0 \)\); then[\s\S]*?status=1/,
  );
});

test('rehearsal runs the tracked migration file, not a rewritten statement', () => {
  assert.match(
    rehearsal,
    /migrations\/20260906174608_add_user_phone_canonical\/migration\.sql/,
  );
  assert.match(rehearsal, /\[\[ -f "\$migration_sql" \]\]/);

  assert.match(
    rehearsal,
    /docker_cli\[@\]\}" cp "\$migration_sql" "\$container:\$container_migration"/,
  );
  assert.match(rehearsal, /-f "\$container_migration"/);
});

test('rehearsal reproduces the deploy transaction boundary', () => {
  assert.match(
    rehearsal,
    /psql_exec --single-transaction -f "\$container_migration"/,
  );
  assert.equal(
    (migration.match(/^ALTER TABLE/gm) ?? []).length,
    3,
    'this migration has three statements, so the transaction boundary is load-bearing',
  );
});

test('migrate lane proves the drop is real and the backup recovers it', () => {
  assert.match(rehearsal, /fail 'DROP left TeamMember\.phone present'/);
  assert.match(
    rehearsal,
    /fail 'restore did not recover the dropped phone values'/,
  );

  assert.match(
    rehearsal,
    /fail 'fixture must contain two users and two team members with one stored phone'/,
  );
});

test('migrate lane proves the new CHECK is enforced, not just present', () => {
  assert.match(rehearsal, /phone_write_accepted '0000000000'/);
  assert.match(rehearsal, /phone_write_accepted '00000000000'/);
  assert.match(rehearsal, /phone_write_rejected '000000000'/);
  assert.match(rehearsal, /phone_write_rejected '000000000000'/);
  assert.match(rehearsal, /phone_write_rejected '0000-000-0000'/);

  assert.match(
    migration,
    /CHECK \("phone" IS NULL OR "phone" ~ '\^\[0-9\]\{10,11\}\$'\)/,
  );
  assert.match(
    rehearsal,
    /User_phone_digits_check is missing or has a different definition/,
  );
});

test('negative lane requires the explicit error and a full rollback', () => {
  assert.match(
    rehearsal,
    /column "phone" of relation "TeamMember" does not exist/,
  );
  assert.match(
    rehearsal,
    /fail 'negative lane left User\.phone behind after the failed migration'/,
  );
  assert.match(
    rehearsal,
    /fail 'negative lane left the phone CHECK behind after the failed migration'/,
  );
});

test('both lanes end on a single-line JSON receipt', () => {
  for (const scenario of ['migrate', 'negative']) {
    assert.ok(
      rehearsal.includes(`"status":"ok","scenario":"${scenario}"`),
      `${scenario} must emit a machine-readable receipt`,
    );
  }

  assert.match(
    rehearsal,
    /\(\( status == 0 \)\) && \[\[ -n "\$success_result" \]\]/,
  );
});

test('rehearsal keeps synthetic phone values out of the mobile deny-list shape', () => {
  const denyList =
    /(^|[^0-9])01[016789][-. ]?[0-9]{3,4}[-. ]?[0-9]{4}($|[^0-9])/m;
  assert.ok(
    !denyList.test(rehearsal),
    'synthetic phone fixtures must not look like real Korean mobile numbers',
  );
});
