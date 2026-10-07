import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  resolveMigrationLedgerPaths,
  runMigrationLedger,
  validateMigrationLedger,
} from './prisma-migration-ledger.mjs';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const backendDirectory = join(repositoryRoot, 'apps/backend');
const migrationsDirectory = join(backendDirectory, 'prisma/migrations');
const packagePath = join(backendDirectory, 'package.json');

for (const [label, input] of [
  ['runtime-relative', 'prisma/migrations'],
  ['absolute', migrationsDirectory],
]) {
  test(`${label} migrations path resolves an absolute Prisma package`, () => {
    const paths = resolveMigrationLedgerPaths(input, backendDirectory);

    assert.equal(paths.migrationsDirectory, migrationsDirectory);
    assert.equal(paths.packagePath, packagePath);
    assert.equal(isAbsolute(paths.packagePath), true);
    assert.match(
      createRequire(paths.packagePath).resolve('@prisma/client'),
      /@prisma/,
    );
  });
}

test('relative-path CLI seam reaches Prisma query initialization', async () => {
  const queryStarted = new Error('synthetic-query-started');
  let disconnected = false;

  class SyntheticPrismaClient {
    $queryRaw() {
      throw queryStarted;
    }

    async $disconnect() {
      disconnected = true;
    }
  }

  function createRequireFromPath(receivedPackagePath) {
    assert.equal(receivedPackagePath, packagePath);
    assert.equal(isAbsolute(receivedPackagePath), true);
    return function requirePrismaClient(specifier) {
      assert.equal(specifier, '@prisma/client');
      return { PrismaClient: SyntheticPrismaClient };
    };
  }

  await assert.rejects(
    runMigrationLedger('prisma/migrations', {
      cwd: backendDirectory,
      createRequireFromPath,
    }),
    queryStarted,
  );
  assert.equal(disconnected, true);
});

const BRIDGE_MIGRATION = '20260823000000_bridge_member_authority';
const CONTRACT_MIGRATION = '20260824000000_contract_member_authority';

function deployedRow(migrationName) {
  return { migrationName, finishedAt: new Date(), rolledBackAt: null };
}

test('bridge migration stays in the committed ledger once deployed', () => {
  const committed = readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  assert.ok(
    committed.includes(BRIDGE_MIGRATION),
    'bridge migration must remain committed — a deployed ledger row cannot be retracted',
  );
});

test('same-timestamp replacement of a deployed migration is rejected', () => {
  const committedNames = ['20260823000000_contract_member_authority'];
  const rows = [deployedRow(BRIDGE_MIGRATION)];

  const issues = validateMigrationLedger(committedNames, rows);

  assert.ok(issues.includes(`unexpected:${BRIDGE_MIGRATION}`));
  assert.ok(
    issues.includes('count:20260823000000_contract_member_authority:0'),
  );
});

test('a strictly later contract migration composes with the deployed bridge', () => {
  const committedNames = [BRIDGE_MIGRATION, CONTRACT_MIGRATION];
  const rows = [deployedRow(BRIDGE_MIGRATION), deployedRow(CONTRACT_MIGRATION)];

  const issues = validateMigrationLedger(committedNames, rows);

  assert.deepEqual(issues, []);

  assert.ok(CONTRACT_MIGRATION > BRIDGE_MIGRATION);
});
