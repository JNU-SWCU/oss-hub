import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const rehearsal = readFileSync(
  new URL('./rehearse-legacy-submission-migrations.sh', import.meta.url),
  'utf8',
);
const fixture = readFileSync(
  new URL(
    '../apps/backend/prisma/fixtures/legacy-submission-rehearsal.sql',
    import.meta.url,
  ),
  'utf8',
);

const GATES = [
  'legacy submission source orphan requires reconciliation',
  'legacy submission current revision requires reconciliation',
  'legacy submission deterministic target id collision requires reconciliation',
  'legacy submission public id collision requires reconciliation',
  'legacy submission header mapping requires reconciliation',
  'legacy submission revision mapping requires reconciliation',
  'legacy review mapping requires reconciliation',
  'legacy submission file provenance requires reconciliation',
  'legacy seed file target provenance requires reconciliation',
];

test('rehearsal initializes disposable paths before the EXIT trap', () => {
  const trap = rehearsal.indexOf('trap cleanup EXIT');
  for (const name of ["staged=''", "backup=''", "port=''"]) {
    const init = rehearsal.indexOf(name);
    assert.ok(init >= 0, `${name} must start empty so set -u cleanup is safe`);
    assert.ok(
      trap > init,
      `${name} must be initialized before trap cleanup EXIT`,
    );
  }
});

test('rehearsal cleanup removes the container with its volumes and both tmp trees', () => {
  assert.match(rehearsal, /docker rm -f -v "\$container"/);
  assert.match(
    rehearsal,
    /mktemp -d "\$\{TMPDIR:-\/tmp\}\/legacy-submission-staged\.XXXXXX"/,
  );
  assert.match(
    rehearsal,
    /mktemp -d "\$\{TMPDIR:-\/tmp\}\/legacy-submission-backup\.XXXXXX"/,
  );
  assert.match(
    rehearsal,
    /if \[\[ -n \$\{staged:-\} \]\]; then\s+rm -rf -- "\$staged"/s,
  );
  assert.match(
    rehearsal,
    /if \[\[ -n \$\{backup:-\} \]\]; then\s+rm -rf -- "\$backup"/s,
  );
});

test('rehearsal owns a disposable database and never reads an ambient DATABASE_URL', () => {
  assert.doesNotMatch(rehearsal, /\$\{?DATABASE_URL:-/);
  assert.match(rehearsal, /-p 0:5432 postgres:17-alpine/);
});

test('rehearsal database is not named oss_hub_test so the bridge fences stay live', () => {
  assert.doesNotMatch(rehearsal, /POSTGRES_DB=oss_hub_test/);
  assert.match(rehearsal, /POSTGRES_DB=legacy_submission_rehearsal/);
  assert.match(rehearsal, /database='legacy_submission_rehearsal'/);
});

test('rehearsal stages the three migrations one stage at a time', () => {
  assert.doesNotMatch(rehearsal, /PRISMA_MIGRATIONS_PATH/);
  assert.doesNotMatch(rehearsal, /<\(/);
  assert.match(
    rehearsal,
    /pnpm exec prisma migrate deploy --schema "\$staged\/schema\.prisma"/,
  );
  for (const stage of [
    '20260830050000_expand_legacy_submission_bridge',
    '20260830100000_bridge_legacy_submissions',
    '20260830180000_contract_legacy_submissions',
  ]) {
    assert.ok(rehearsal.includes(stage), `rehearsal must stage ${stage}`);
  }
});

test('rehearsal seeds the source fixture before any destructive DDL', () => {
  assert.match(rehearsal, /legacy-submission-rehearsal\.sql/);
  const seed = rehearsal.indexOf('\nseed_fixture\n');
  const contract = rehearsal.indexOf('stage "$contract_dir"');
  assert.ok(seed >= 0 && contract >= 0);
  assert.ok(
    seed < contract,
    'the fixture must be seeded before contract is staged',
  );
});

test('the fixture carries both reserved seed graphs and production-shaped graphs', () => {
  assert.match(fixture, /'seed:/);
  assert.match(fixture, /synthetic/);

  assert.match(fixture, /INSERT INTO "SubmissionRevision"/);
  assert.match(fixture, /INSERT INTO "Review"/);
  assert.match(fixture, /INSERT INTO "SubmissionFile"/);
});

test('migrate lane compares row counts and the id mapping across the migration', () => {
  assert.match(rehearsal, /submissions_before=/);
  assert.match(rehearsal, /revisions_before=/);
  assert.match(rehearsal, /reviews_before=/);
  assert.match(rehearsal, /mapping_before=/);
  assert.match(rehearsal, /mapping_after=/);
  assert.match(
    rehearsal,
    /expect_equal 'header mapping' "\$mapping_before" "\$mapping_after"/,
  );
  assert.match(
    rehearsal,
    /expect_equal 'revision mapping' "\$history_before" "\$history_after"/,
  );
  assert.match(
    rehearsal,
    /expect_equal 'review mapping' "\$review_before" "\$review_after"/,
  );
});

test('migrate lane proves the three source tables are gone and control rows are untouched', () => {
  for (const table of ['Review', 'SubmissionRevision', 'Submission']) {
    assert.ok(
      rehearsal.includes(`'${table}'`),
      `migrate lane must assert the ${table} table is gone`,
    );
  }
  assert.match(rehearsal, /control_before/);
  assert.match(rehearsal, /control_after/);
});

test('migrate lane proves the bridge write fence is live before contract', () => {
  assert.match(rehearsal, /legacy submission source is read only after bridge/);
});

test('migrate lane proves the pre-contract backup restores the dropped tables', () => {
  assert.match(
    rehearsal,
    /pg_dump -U migration -d legacy_submission_rehearsal --format=custom/,
  );
  assert.match(
    rehearsal,
    /pg_restore -U migration -d legacy_submission_rehearsal --no-owner/,
  );
});

test('negative lane names all nine preflight gates by their own message', () => {
  for (const gate of GATES) {
    assert.ok(
      rehearsal.includes(gate),
      `negative lane must target the gate: ${gate}`,
    );
  }
  assert.match(rehearsal, /assert_preflight_aborted /);
});

test('every negative lane restores the post-bridge snapshot before perturbing', () => {
  assert.match(rehearsal, /restore_post_bridge/);
});

test('every negative lane re-proves the rollback surface survived the abort', () => {
  assert.match(
    rehearsal,
    /for surviving in 'Submission' 'SubmissionRevision' 'Review'/,
  );
  assert.match(rehearsal, /was dropped despite the failed preflight/);
  assert.match(
    rehearsal,
    /SubmissionFile\.\\"submissionRevisionId\\" was dropped despite the failed preflight/,
  );
});
