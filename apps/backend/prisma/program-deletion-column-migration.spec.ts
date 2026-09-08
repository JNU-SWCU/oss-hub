import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rehearsal = readFileSync(
  resolve(__dirname, '../../../scripts/rehearse-program-deletion-column.sh'),
  'utf8',
);
const migration = readFileSync(
  resolve(
    __dirname,
    'migrations/20260908150000_drop_program_deletion_protected/migration.sql',
  ),
  'utf8',
);

test('migration is the single plain destructive statement for the second release', () => {
  assert.equal(
    migration,
    'ALTER TABLE "Program" DROP COLUMN "deletionProtected";\n',
  );
  assert.doesNotMatch(migration, /IF\s+EXISTS/i);
  assert.doesNotMatch(migration, /ADD\s+COLUMN/i);
});

test('rehearsal owns cleanup and initializes trap state before the EXIT trap', () => {
  for (const name of ["tmp_root=''", "backup=''", 'result_emitted=0']) {
    const init = rehearsal.indexOf(name);
    const trap = rehearsal.indexOf('trap cleanup EXIT');
    assert.ok(init >= 0, `${name} must be initialized`);
    assert.ok(
      trap > init,
      `${name} must be initialized before cleanup is trapped`,
    );
  }
  assert.match(rehearsal, /"\$\{docker_cli\[@\]\}" rm -f -v "\$container"/);
  assert.doesNotMatch(rehearsal, /\|\| true/);
  assert.match(rehearsal, /container_started=0/);
  assert.match(rehearsal, /container_started == 1/);
  assert.match(rehearsal, /cleanup_status=0/);
  assert.match(rehearsal, /reason=cleanup failed/);
  assert.match(
    rehearsal,
    /tmp_root=\$\(mktemp -d "\$\{TMPDIR:-\/tmp\}\/program-column-rehearsal\.XXXXXX"\)/,
  );
  assert.match(rehearsal, /rm -rf -- "\$tmp_root"/);
});

test('rehearsal never consumes an ambient connection or production environment', () => {
  assert.doesNotMatch(rehearsal, /DATABASE_URL/);
  assert.match(rehearsal, /POSTGRES_DB="\$database"/);
  assert.match(rehearsal, /database='program_column_rehearsal'/);
  assert.match(rehearsal, /postgres:17-alpine/);
  assert.match(rehearsal, /-e "PGPASSWORD=\$password"/);
  assert.doesNotMatch(rehearsal, /-p\s+0:5432/);
});

test('rehearsal fails closed for remote Docker endpoints with Docker precedence preserved', () => {
  assert.match(rehearsal, /DOCKER_CONTEXT takes precedence over DOCKER_HOST/);
  assert.match(rehearsal, /if \[\[ -n \$\{DOCKER_CONTEXT:-\} \]\]/);
  assert.match(rehearsal, /elif \[\[ -n \$\{DOCKER_HOST:-\} \]\]/);
  assert.match(
    rehearsal,
    /docker context inspect "\$effective_docker_context"/,
  );
  assert.match(
    rehearsal,
    /--format '\{\{ \(index \.Endpoints "docker"\)\.Host \}\}'/,
  );
  assert.match(rehearsal, /\[\[ "\$effective_docker_host" == unix:\/\/\* \]\]/);
  assert.match(
    rehearsal,
    /refusing a non-local Docker endpoint; only unix:\/\/ is allowed/,
  );
  assert.match(
    rehearsal,
    /docker_cli=\(env -u DOCKER_HOST -u DOCKER_CONTEXT docker --context "\$effective_docker_context"\)/,
  );
  assert.match(
    rehearsal,
    /docker_cli=\(env -u DOCKER_CONTEXT docker --host "\$effective_docker_host"\)/,
  );
});

test('all container SQL connections carry bounded connect and statement settings', () => {
  assert.match(rehearsal, /pg_connect_timeout='5'/);
  assert.match(
    rehearsal,
    /pg_options='-c statement_timeout=30000 -c lock_timeout=5000'/,
  );
  assert.match(rehearsal, /-e "PGCONNECT_TIMEOUT=\$pg_connect_timeout"/);
  assert.match(rehearsal, /-e "PGOPTIONS=\$pg_options"/);
  assert.match(
    rehearsal,
    /pg_isready -U migration -d "\$database" -t "\$pg_connect_timeout"/,
  );
  assert.match(rehearsal, /pg_dump --format=custom/);
  assert.match(rehearsal, /pg_restore --exit-on-error/);
});

test('readiness is bounded and the rehearsal is explicitly focused-table coverage', () => {
  assert.match(rehearsal, /attempt <= 60/);
  assert.match(rehearsal, /after 60 attempts/);
  assert.match(rehearsal, /coverage":"focused-table"/);
  assert.doesNotMatch(rehearsal, /pnpm\s+exec\s+prisma\s+migrate\s+deploy/);
});

test('fixture contains both protection states, realistic Program fields, and unrelated data', () => {
  for (const fragment of [
    'CREATE TABLE "Program"',
    '"deletionProtected" BOOLEAN NOT NULL DEFAULT false',
    "'synthetic-program-protected'",
    "'synthetic-program-open'",
    'CREATE TABLE "ProgramNote"',
    'CREATE TABLE "SyntheticUnrelated"',
    'Program_applicationWithinProgramWindow_check',
    'Program_teamSize_check',
    'ProgramNote_programId_fkey',
  ]) {
    assert.ok(rehearsal.includes(fragment), `fixture must include ${fragment}`);
  }
  assert.match(
    rehearsal,
    /protected_rows_before=\$\(psql_value[\s\S]*?deletionProtected[\s\S]*?\)/,
  );
  assert.match(
    rehearsal,
    /unprotected_rows_before=\$\(psql_value[\s\S]*?NOT "deletionProtected"/,
  );
});

test('migrate lane invokes the tracked SQL and verifies the post-drop surface', () => {
  assert.match(
    rehearsal,
    /pg_dump --format=custom --no-owner -U migration -d "\$database"/,
  );
  assert.match(
    rehearsal,
    /"\$\{docker_cli\[@\]\}" cp "\$migration_sql" "\$container:\$container_migration"/,
  );
  assert.match(rehearsal, /psql_exec -f "\$container_migration"/);
  assert.match(rehearsal, /program_has_protection_column/);
  assert.match(rehearsal, /columns_without_protection_before/);
  assert.match(rehearsal, /program_digest/);
  assert.match(rehearsal, /control_digest/);
  assert.match(rehearsal, /note_digest/);
  assert.match(rehearsal, /constraint_digest/);
  assert.match(rehearsal, /index_digest/);
  assert.match(rehearsal, /DROP left deletionProtected present/);
  assert.match(rehearsal, /Program row contents changed/);
  assert.match(rehearsal, /unrelated control data changed/);
});

test('restore lane recreates the pre-drop image and checks protection values', () => {
  assert.match(rehearsal, /restore_backup\(\)/);
  assert.match(rehearsal, /dropdb -U migration --if-exists "\$database"/);
  assert.match(rehearsal, /createdb -U migration "\$database"/);
  assert.match(
    rehearsal,
    /pg_restore --exit-on-error --no-owner -U migration -d "\$database" <"\$backup"/,
  );
  assert.match(rehearsal, /program_protection_digest/);
  assert.match(rehearsal, /restore did not recover protection values/);
});

test('negative lane rejects an already absent column and proves unrelated data is unchanged', () => {
  assert.match(
    rehearsal,
    /ALTER TABLE "Program" DROP COLUMN "deletionProtected"/,
  );
  assert.match(rehearsal, /negative_status=\$\?/);
  assert.match(rehearsal, /negative_status != 0/);
  assert.match(
    rehearsal,
    /column "deletionProtected" of relation "Program" does not exist/,
  );
  assert.match(rehearsal, /negative_program_before=\$\(program_digest\)/);
  assert.match(rehearsal, /negative_control_before=\$\(control_digest\)/);
  assert.match(rehearsal, /negative lane changed unrelated data/);
  assert.match(rehearsal, /migration_rejected_drift":true/);
});
