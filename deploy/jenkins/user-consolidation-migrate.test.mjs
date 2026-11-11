import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import test from 'node:test';

const helpers = dirname(fileURLToPath(import.meta.url));
const stateTool = join(helpers, 'user-consolidation-watchdog-state.mjs');
const digest = (value) => createHash('sha256').update(value).digest('hex');

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'user-consolidation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const artifacts = join(root, 'deploy/jenkins/user-consolidation');
  const migrationId = '20261102160000_consolidate_user_domain';
  const migration = join(root, 'apps/backend/prisma/migrations', migrationId);
  mkdirSync(artifacts, { recursive: true });
  mkdirSync(migration, { recursive: true });
  const sql = 'BEGIN; SELECT 1; COMMIT;\n';
  for (const name of ['preflight', 'reconcile', 'rollback', 'open'])
    writeFileSync(join(artifacts, `${name}.sql`), sql);
  writeFileSync(join(migration, 'migration.sql'), sql);
  const previous = join(
    root,
    'apps/backend/prisma/migrations/20261031000000_previous',
  );
  mkdirSync(previous);
  writeFileSync(join(previous, 'migration.sql'), sql);
  const laterId = '20261111170200_later';
  const later = join(root, 'apps/backend/prisma/migrations', laterId);
  mkdirSync(later);
  writeFileSync(join(later, 'migration.sql'), sql);
  const manifest = {
    version: 1,
    migrationId,
    previousMigrationId: '20261031000000_previous',
    sha256: Object.fromEntries(
      ['migration', 'preflight', 'reconcile', 'rollback', 'open'].map((key) => [
        key,
        digest(sql),
      ]),
    ),
  };
  writeFileSync(join(artifacts, 'manifest.json'), JSON.stringify(manifest));
  const run = (...args) =>
    spawnSync(process.execPath, [stateTool, ...args], {
      encoding: 'utf8',
      timeout: 5000,
    });
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'timeout'), '#!/bin/sh\nshift 3\nexec "$@"\n', {
    mode: 0o755,
  });
  writeFileSync(
    join(bin, 'docker'),
    '#!/bin/sh\ntest "$1" = exec || exit 2\nshift 2\nexec "$@"\n',
    { mode: 0o755 },
  );
  writeFileSync(
    join(bin, 'psql'),
    `#!${process.execPath}\nprocess.stdout.write(process.env.FIXTURE_LEDGER);\n`,
    { mode: 0o755 },
  );
  const detect = (rows) =>
    spawnSync(
      'bash',
      [join(helpers, 'user-consolidation-migrate.sh'), '--detect'],
      {
        encoding: 'utf8',
        timeout: 5000,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          UC_STATE_ROOT: root,
          UC_ISOLATED_HOST: '1',
          RELEASE_SOURCE: root,
          PREV_POSTGRES_ID: 'postgres',
          POSTGRES_USER: 'fixture',
          POSTGRES_DB: 'fixture',
          FIXTURE_LEDGER: JSON.stringify(rows),
        },
      },
    );
  return { root, artifacts, manifest, laterId, run, detect };
}

test('release artifacts reject changed rollback bytes before any receipt exists', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.artifacts, 'rollback.sql'), 'SELECT 2;\n');
  const result = f.run('manifest', f.root);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /artifact-hash:rollback/);
});

test('a release missing the manifest cannot send the destructive migration to generic deploy', (t) => {
  const f = fixture(t);
  rmSync(join(f.artifacts, 'manifest.json'));
  const result = f.run('manifest', f.root);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /manifest-required/);
});

test('receipt refuses an absent measured recovery reserve', (t) => {
  const f = fixture(t);
  const result = f.run(
    'init',
    f.root,
    'boot-one',
    '0',
    JSON.stringify({ migrationId: f.manifest.migrationId }),
  );
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /recovery-bound/);
});

for (const scenario of [
  'pending',
  'applied',
  'resolved-pending',
  'resolved-applied',
  'resolved-unrelated',
  'resolved-changed',
  'unknown',
  'unfinished',
  'changed',
  'duplicate',
  'later-rolled-back',
  'later-retried',
  'later-hole',
]) {
  test(`migration dispatch classifies the ${scenario} ledger`, (t) => {
    const f = fixture(t);
    const row = {
      migration_name: f.manifest.previousMigrationId,
      checksum: f.manifest.sha256.migration,
      finished_at: '2026-10-31',
      rolled_back_at: null,
    };
    const rows = [row];
    switch (scenario) {
      case 'pending':
        break;
      case 'applied':
        rows.push({ ...row, migration_name: f.manifest.migrationId });
        break;
      case 'resolved-applied':
        rows.push({ ...row, migration_name: f.manifest.migrationId });
        rows.push({
          ...row,
          migration_name: f.manifest.migrationId,
          finished_at: null,
          rolled_back_at: 'resolved',
        });
        break;
      case 'resolved-pending':
        rows.push({
          ...row,
          migration_name: f.manifest.migrationId,
          finished_at: null,
          rolled_back_at: 'resolved',
        });
        break;
      case 'resolved-unrelated':
        row.finished_at = null;
        row.rolled_back_at = 'resolved';
        break;
      case 'resolved-changed':
        rows.push({
          ...row,
          migration_name: f.manifest.migrationId,
          finished_at: null,
          rolled_back_at: 'resolved',
          checksum: '0'.repeat(64),
        });
        break;
      case 'unknown':
        rows.push({ ...row, migration_name: 'unexpected' });
        break;
      case 'unfinished':
        row.finished_at = null;
        break;
      case 'changed':
        row.checksum = '0'.repeat(64);
        break;
      case 'duplicate':
        rows.push({ ...row });
        break;
      case 'later-rolled-back':
        rows.push({ ...row, migration_name: f.manifest.migrationId });
        rows.push({
          ...row,
          migration_name: f.laterId,
          finished_at: null,
          rolled_back_at: 'resolved',
        });
        break;
      case 'later-retried':
        rows.push({ ...row, migration_name: f.manifest.migrationId });
        rows.push({
          ...row,
          migration_name: f.laterId,
          finished_at: null,
          rolled_back_at: 'resolved',
        });
        rows.push({ ...row, migration_name: f.laterId });
        break;
      case 'later-hole':
        rows.push({
          ...row,
          migration_name: f.manifest.migrationId,
          finished_at: null,
          rolled_back_at: 'resolved',
        });
        rows.push({ ...row, migration_name: f.laterId });
        break;
      default:
        assert.fail('unknown fixture');
    }
    const result = f.detect(rows);
    if (
      [
        'applied',
        'resolved-applied',
        'later-rolled-back',
        'later-retried',
      ].includes(scenario)
    ) {
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), 'ordinary');
    } else if (['pending', 'resolved-pending'].includes(scenario)) {
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), 'required');
    } else if (scenario === 'later-hole') {
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /noncontiguous-migration-ledger/);
    } else if (scenario === 'resolved-unrelated') {
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /unexpected-old-schema/);
    } else {
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /unknown-migration-ledger/);
    }
  });
}

for (const scenario of [
  'current',
  'resolved',
  'successful',
  'unrelated',
  'newer',
  'stale',
  'changed',
]) {
  test(`failed-attempt recovery only accepts the current owned ledger: ${scenario}`, (t) => {
    const f = fixture(t);
    mkdirSync(join(f.root, 'sql'));
    writeFileSync(
      join(f.root, 'sql/manifest.json'),
      JSON.stringify(f.manifest),
    );
    assert.equal(f.run('init', f.root, 'boot-one', '300', '{}').status, 0);
    const row = {
      migration_name: f.manifest.migrationId,
      checksum: f.manifest.sha256.migration,
      finished_at: null,
      rolled_back_at: null,
      startedEpoch: Date.now() / 1000 + 1,
    };
    switch (scenario) {
      case 'current':
        break;
      case 'resolved':
        row.rolled_back_at = 'resolved';
        break;
      case 'successful':
        row.finished_at = 'finished';
        break;
      case 'unrelated':
        row.migration_name = f.manifest.previousMigrationId;
        break;
      case 'newer':
        row.migration_name = '20261103000000_unrelated';
        row.finished_at = 'finished';
        break;
      case 'stale':
        row.startedEpoch = 1;
        break;
      case 'changed':
        row.checksum = '0'.repeat(64);
        break;
      default:
        assert.fail('unknown fixture');
    }
    const result = f.run('failed-attempt', f.root, JSON.stringify([row]));
    if (['current', 'resolved'].includes(scenario)) {
      assert.equal(result.status, 0, result.stderr);
      assert.equal(
        result.stdout.trim(),
        scenario === 'current' ? 'resolve' : 'clean',
      );
    } else {
      assert.equal(result.status, 1, result.stderr);
      assert.match(
        result.stderr,
        /unknown-failed-attempt|stale-failed-attempt/,
      );
    }
  });
}

test('an irreversible open marker prevents a stale phase from authorizing rollback', (t) => {
  const f = fixture(t);
  assert.equal(
    f.run(
      'init',
      f.root,
      'boot-one',
      '300',
      JSON.stringify({ migrationId: f.manifest.migrationId }),
    ).status,
    0,
  );
  assert.equal(f.run('phase', f.root, 'VERIFIED').status, 0);
  assert.equal(f.run('commit-open', f.root, 'candidate').status, 0);
  const receipt = JSON.parse(
    readFileSync(join(f.root, 'receipt.json'), 'utf8'),
  );
  receipt.phase = 'VERIFIED';
  writeFileSync(join(f.root, 'receipt.json'), JSON.stringify(receipt));
  const result = f.run('rollback-allowed', f.root);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /open-committed/);
});

test('a host reboot never extends the monotonic deadline using a later wall clock', (t) => {
  const f = fixture(t);
  assert.equal(f.run('init', f.root, 'boot-one', '300', '{}').status, 0);
  const result = f.run('remaining', f.root, 'boot-two', 'forward');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /boot-changed/);
});

test('an expired forward deadline preserves a separate recovery budget', (t) => {
  const f = fixture(t);
  assert.equal(f.run('init', f.root, 'boot-one', '300', '{}').status, 0);
  const receipt = JSON.parse(
    readFileSync(join(f.root, 'receipt.json'), 'utf8'),
  );
  receipt.abortWall = 1;
  writeFileSync(join(f.root, 'receipt.json'), JSON.stringify(receipt));
  assert.equal(f.run('remaining', f.root, 'boot-one', 'forward').status, 1);
  const recovery = f.run('remaining', f.root, 'boot-one', 'recovery');
  assert.equal(recovery.status, 0, recovery.stderr);
  assert.ok(Number(recovery.stdout) > 0);
});

test('an unknown durable phase cannot authorize snapshot rollback', (t) => {
  const f = fixture(t);
  assert.equal(f.run('init', f.root, 'boot-one', '300', '{}').status, 0);
  const receipt = JSON.parse(
    readFileSync(join(f.root, 'receipt.json'), 'utf8'),
  );
  writeFileSync(
    join(f.root, 'receipt.json'),
    JSON.stringify({ ...receipt, phase: 'AMBIGUOUS' }),
  );
  const result = f.run('rollback-allowed', f.root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown-receipt/);
});

test('a terminal receipt rejects an open marker from another run', (t) => {
  const f = fixture(t);
  assert.equal(f.run('init', f.root, 'boot-one', '300', '{}').status, 0);
  assert.equal(f.run('phase', f.root, 'VERIFIED').status, 0);
  assert.equal(f.run('commit-open', f.root, 'candidate').status, 0);
  assert.equal(f.run('phase', f.root, 'OPEN').status, 0);
  writeFileSync(
    join(f.root, 'OPEN_COMMITTED'),
    JSON.stringify({ runId: 'different-run', target: 'candidate' }),
  );
  const result = f.run('terminal', f.root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid-terminal-receipt/);
});
