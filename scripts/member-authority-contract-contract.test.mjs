import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validateContractContract } from './member-authority-contract-contract.mjs';

const schemaPath = new URL('../apps/backend/prisma/schema.prisma', import.meta.url);
const migrationPath = new URL(
  '../apps/backend/prisma/migrations/20260823000000_contract_member_authority/migration.sql',
  import.meta.url,
);

function loadContract() {
  return {
    schema: readFileSync(schemaPath, 'utf8'),
    migration: readFileSync(migrationPath, 'utf8'),
  };
}

test('contract preflight trim predicates match CHECK (btrim equals stored value)', () => {
  const { schema, migration } = loadContract();

  assert.deepEqual(validateContractContract(schema, migration), []);
  assert.match(migration, /btrim\("name"\) <> "name"/);
  assert.match(migration, /btrim\("department"\) <> "department"/);
  assert.match(migration, /btrim\("affiliationName"\) <> "affiliationName"/);
  assert.match(migration, /btrim\("name"\) = ''/);
  assert.match(migration, /length\("name"\) < 1 OR length\("name"\) > 100/);
});

test('contract validator rejects a preflight that only checks empty trim', () => {
  const { schema, migration } = loadContract();
  const loosened = migration.replace(
    /^\s*OR btrim\("(?:name|department|affiliationName)"\) <> "(?:name|department|affiliationName)"\n|btrim\("(?:name|department|affiliationName)"\) <> "(?:name|department|affiliationName)"\n/gm,
    '',
  );

  const failures = validateContractContract(schema, loosened);
  assert.ok(
    failures.some((failure) => failure.includes('preflight')),
    `expected a preflight failure, got: ${failures.join('; ')}`,
  );
});
