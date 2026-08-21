import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  resolveMigrationLedgerPaths,
  runMigrationLedger,
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
