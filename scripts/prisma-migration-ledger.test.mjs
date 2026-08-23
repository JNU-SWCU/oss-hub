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

/**
 * 배포된 bridge 마이그레이션은 원장에서 **영구히 남는다**.
 *
 * `20260823000000_bridge_member_authority`가 운영에 한 번 적용되면
 * `_prisma_migrations`에 그 이름으로 행이 생기고, 소스에서 파일을 지우거나 같은
 * 타임스탬프로 내용을 갈아끼워도 그 행은 사라지지 않는다. 그래서 파괴적 contract
 * 단계는 이 파일을 대체하는 방식으로 올 수 없고, **더 늦은 별도 마이그레이션**으로
 * 와야 한다.
 *
 * 아래 세 테스트가 그 규칙을 기계로 잠근다 — 문서 주석만으로는 다음 사람이 같은
 * 타임스탬프를 재사용하는 것을 막지 못한다.
 */
const BRIDGE_MIGRATION = '20260823000000_bridge_member_authority';
const CONTRACT_MIGRATION = '20260824000000_contract_member_authority';

function deployedRow(migrationName) {
  return { migrationName, finishedAt: new Date(), rolledBackAt: null };
}

test('bridge migration stays in the committed ledger once deployed', () => {
  // Given — 저장소에 실제로 그 디렉터리가 있어야 원장 대조가 성립한다.
  const committed = readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  // Then
  assert.ok(
    committed.includes(BRIDGE_MIGRATION),
    'bridge migration must remain committed — a deployed ledger row cannot be retracted',
  );
});

test('same-timestamp replacement of a deployed migration is rejected', () => {
  // Given — 배포된 DB에는 bridge 행이 있는데, 소스에서 그 이름을 지우고
  // 같은 타임스탬프를 다른 이름으로 재사용한 상태다.
  const committedNames = ['20260823000000_contract_member_authority'];
  const rows = [deployedRow(BRIDGE_MIGRATION)];

  // When
  const issues = validateMigrationLedger(committedNames, rows);

  // Then — 배포된 행은 "소스에 없는 마이그레이션"으로, 새 이름은 "적용된 적 없음"으로
  // 각각 걸린다. 어느 쪽도 조용히 넘어가지 않는다.
  assert.ok(issues.includes(`unexpected:${BRIDGE_MIGRATION}`));
  assert.ok(
    issues.includes('count:20260823000000_contract_member_authority:0'),
  );
});

test('a strictly later contract migration composes with the deployed bridge', () => {
  // Given — 권장 경로: bridge를 그대로 두고 더 늦은 마이그레이션을 얹는다.
  const committedNames = [BRIDGE_MIGRATION, CONTRACT_MIGRATION];
  const rows = [deployedRow(BRIDGE_MIGRATION), deployedRow(CONTRACT_MIGRATION)];

  // When
  const issues = validateMigrationLedger(committedNames, rows);

  // Then
  assert.deepEqual(issues, []);
  // 그리고 이름 순서가 곧 적용 순서다 — contract가 bridge보다 뒤에 온다.
  assert.ok(CONTRACT_MIGRATION > BRIDGE_MIGRATION);
});
