import {
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  fsyncSync,
  renameSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { uptime } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';

class ReceiptError extends Error {}
const fail = (reason) => {
  throw new ReceiptError(reason);
};
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
const hash = (file) =>
  createHash('sha256').update(readFileSync(file)).digest('hex');
const consolidationMigration = '20261102160000_consolidate_user_domain';
const phases = new Set([
  'PREPARED',
  'FENCING',
  'FENCED',
  'BACKED_UP',
  'MIGRATING',
  'MIGRATED',
  'VERIFIED',
  'RECOVERING',
  'OPEN_COMMITTED',
  'OPEN',
  'ROLLED_BACK',
  'NEEDS_FORWARD_RECOVERY',
  'RECOVERY_FAILED',
]);

function receipt(file) {
  const value = json(file);
  if (
    value.version !== 1 ||
    !phases.has(value.phase) ||
    typeof value.runId !== 'string'
  )
    fail('unknown-receipt');
  return value;
}

// A rename is atomic; both the new inode and the containing directory must be durable.
function durable(file, value) {
  const temporary = `${file}.${randomUUID()}`;
  writeFileSync(temporary, `${JSON.stringify(value)}\n`, {
    mode: 0o600,
    flag: 'wx',
  });
  const fd = openSync(temporary, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, file);
  const directory = openSync(join(file, '..'), 'r');
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

function manifest(source) {
  const directory = join(source, 'deploy/jenkins/user-consolidation');
  const file = join(directory, 'manifest.json');
  if (!existsSync(file)) {
    const migrations = join(source, 'apps/backend/prisma/migrations');
    if (
      existsSync(migrations) &&
      readdirSync(migrations).includes(consolidationMigration)
    )
      fail('manifest-required');
    return null;
  }
  const value = json(file);
  if (
    value.version !== 1 ||
    value.migrationId !== consolidationMigration ||
    !/^\d{14}_[a-z0-9_]+$/.test(value.previousMigrationId)
  )
    fail('manifest-invalid');
  for (const name of [
    'migration',
    'preflight',
    'reconcile',
    'rollback',
    'open',
  ]) {
    const artifact =
      name === 'migration'
        ? join(
            source,
            'apps/backend/prisma/migrations',
            value.migrationId,
            'migration.sql',
          )
        : join(directory, `${name}.sql`);
    if (
      !/^[a-f0-9]{64}$/.test(value.sha256?.[name]) ||
      hash(artifact) !== value.sha256[name]
    )
      fail(`artifact-hash:${name}`);
  }
  return value;
}

function remaining(receipt, boot, mode) {
  if (mode !== 'forward' && mode !== 'recovery') fail('invalid-budget-mode');
  if (mode === 'forward' && boot !== receipt.boot) fail('boot-changed');
  // A reboot triggers immediate recovery. Wall-clock regression is never extra time.
  const now = Date.now() / 1000;
  if (now < receipt.startedWall) fail('wall-clock-regressed');
  const wall = (mode === 'forward' ? receipt.abortWall : receipt.endWall) - now;
  const monotonic =
    (mode === 'forward' ? receipt.abortMono : receipt.endMono) - uptime();
  const seconds = Math.floor(
    boot === receipt.boot
      ? Math.min(wall, monotonic)
      : Math.min(wall, receipt.recoverySeconds),
  );
  if (!Number.isFinite(seconds) || seconds <= 0) fail('deadline-expired');
  return seconds;
}

function main() {
  const [command, directory, ...args] = process.argv.slice(2);
  const file = join(directory, 'receipt.json');
  const marker = join(directory, 'OPEN_COMMITTED');
  switch (command) {
    case 'manifest': {
      process.stdout.write(`${JSON.stringify(manifest(directory))}\n`);
      return;
    }
    case 'classify': {
      const expected = manifest(directory);
      if (expected === null) {
        process.stdout.write('ordinary\n');
        return;
      }
      const migrations = join(directory, 'apps/backend/prisma/migrations');
      const names = readdirSync(migrations, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      const rows = JSON.parse(args[0]);
      if (!Array.isArray(rows) || rows.length === 0)
        fail('unknown-migration-ledger');
      const applied = new Map();
      for (const row of rows) {
        if (
          !names.includes(row.migration_name) ||
          row.checksum !==
            hash(join(migrations, row.migration_name, 'migration.sql'))
        )
          fail('unknown-migration-ledger');
        if (
          row.migration_name === expected.migrationId &&
          row.finished_at === null &&
          row.rolled_back_at !== null
        )
          continue;
        if (
          applied.has(row.migration_name) ||
          row.finished_at === null ||
          row.rolled_back_at !== null
        )
          fail('unknown-migration-ledger');
        applied.set(row.migration_name, row);
      }
      if (names.slice(0, applied.size).some((name) => !applied.has(name)))
        fail('noncontiguous-migration-ledger');
      if (applied.has(expected.migrationId)) process.stdout.write('ordinary\n');
      else if (
        names[applied.size - 1] === expected.previousMigrationId &&
        names[applied.size] === expected.migrationId
      )
        process.stdout.write('required\n');
      else fail('unexpected-old-schema');
      return;
    }
    case 'failed-attempt': {
      const current = receipt(file),
        expected = json(join(directory, 'sql/manifest.json'));
      const rows = JSON.parse(args[0]);
      if (
        expected.migrationId !== consolidationMigration ||
        !Array.isArray(rows)
      )
        fail('unknown-failed-attempt');
      let unfinished = 0;
      for (const row of rows) {
        if (
          row.migration_name !== expected.migrationId ||
          row.finished_at !== null ||
          row.checksum !== expected.sha256.migration
        )
          fail('unknown-failed-attempt');
        if (row.rolled_back_at !== null) continue;
        if (
          !Number.isFinite(row.startedEpoch) ||
          row.startedEpoch < current.startedWall
        )
          fail('stale-failed-attempt');
        unfinished += 1;
      }
      process.stdout.write(unfinished > 0 ? 'resolve\n' : 'clean\n');
      return;
    }
    case 'init': {
      if (existsSync(file) || existsSync(marker))
        fail('receipt-already-exists');
      const [boot, bound, metadata] = args;
      const recoverySeconds = Number(bound);
      if (
        !boot ||
        !Number.isInteger(recoverySeconds) ||
        recoverySeconds < 1 ||
        recoverySeconds > 1200
      )
        fail('recovery-bound-required');
      const startedWall = Date.now() / 1000,
        startedMono = uptime();
      durable(file, {
        version: 1,
        runId: randomUUID(),
        phase: 'PREPARED',
        boot,
        recoverySeconds,
        startedWall,
        startedMono,
        abortWall: startedWall + 1800 - recoverySeconds - 120,
        abortMono: startedMono + 1800 - recoverySeconds - 120,
        endWall: startedWall + 1800,
        endMono: startedMono + 1800,
        metadata: JSON.parse(metadata),
      });
      return;
    }
    case 'phase': {
      const current = receipt(file),
        [phase] = args;
      if (!phases.has(phase)) fail('unknown-phase');
      if (
        existsSync(marker) &&
        ![
          'OPEN_COMMITTED',
          'OPEN',
          'ROLLED_BACK',
          'NEEDS_FORWARD_RECOVERY',
        ].includes(phase)
      )
        fail('open-committed');
      if (['OPEN', 'ROLLED_BACK'].includes(phase) && !existsSync(marker))
        fail('missing-open-marker');
      durable(file, {
        ...current,
        phase,
        migrationAttempted:
          current.migrationAttempted === true || phase === 'MIGRATING',
      });
      process.stdout.write(`PHASE=${phase}\n`);
      return;
    }
    case 'commit-open': {
      const current = receipt(file),
        [target] = args;
      if (!['candidate', 'previous'].includes(target) || existsSync(marker))
        fail('open-committed');
      if (
        (target === 'candidate' && current.phase !== 'VERIFIED') ||
        (target === 'previous' && current.phase !== 'RECOVERING')
      )
        fail('unverified-open');
      durable(marker, { runId: current.runId, target });
      durable(file, { ...current, phase: 'OPEN_COMMITTED', target });
      process.stdout.write('PHASE=OPEN_COMMITTED\n');
      return;
    }
    case 'rollback-allowed': {
      const current = receipt(file);
      if (
        existsSync(marker) ||
        [
          'OPEN_COMMITTED',
          'OPEN',
          'ROLLED_BACK',
          'NEEDS_FORWARD_RECOVERY',
        ].includes(current.phase)
      )
        fail('open-committed');
      return;
    }
    case 'terminal': {
      const current = receipt(file),
        commit = json(marker);
      if (
        !['OPEN', 'ROLLED_BACK'].includes(current.phase) ||
        commit.runId !== current.runId ||
        commit.target !== current.target ||
        commit.target !== (current.phase === 'OPEN' ? 'candidate' : 'previous')
      )
        fail('invalid-terminal-receipt');
      return;
    }
    case 'write-allowed': {
      const current = receipt(file),
        commit = json(marker);
      if (
        current.phase !== 'OPEN_COMMITTED' ||
        commit.runId !== current.runId ||
        commit.target !== args[0] ||
        current.target !== args[0]
      )
        fail('write-decision-required');
      return;
    }
    case 'remaining':
      process.stdout.write(`${remaining(receipt(file), args[0], args[1])}\n`);
      return;
    case 'backup': {
      const current = receipt(file);
      durable(file, {
        ...current,
        backupSha256: hash(join(directory, 'final.dump')),
      });
      return;
    }
    case 'armed': {
      const current = receipt(file);
      durable(join(directory, 'watchdog-armed.json'), {
        runId: current.runId,
        boot: args[0],
      });
      return;
    }
    case 'check-armed': {
      const current = receipt(file),
        armed = json(join(directory, 'watchdog-armed.json'));
      if (armed.runId !== current.runId || armed.boot !== args[0])
        fail('watchdog-unarmed');
      return;
    }
    default:
      fail('unknown-command');
  }
}

try {
  main();
} catch (error) {
  if (!(error instanceof Error)) throw error;
  // Do not print underlying command output, JSON values, paths containing secrets, or SQL.
  process.stderr.write(
    `FAIL_CLOSED ${error instanceof ReceiptError ? error.message : 'receipt-io'}\n`,
  );
  process.exitCode = 1;
}
