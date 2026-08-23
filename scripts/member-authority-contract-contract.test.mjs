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

test('shipped contract migration and schema satisfy the checker', () => {
  const { schema, migration } = loadContract();
  assert.deepEqual(validateContractContract(schema, migration), []);
});

test('contract preflight trim predicates match CHECK (btrim equals stored value)', () => {
  const { migration } = loadContract();
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

test('contract validator rejects a missing preflight gate', () => {
  const { schema, migration } = loadContract();
  const stripped = migration.replace(
    '"department" IS DISTINCT FROM "affiliationName"',
    '"department" = "affiliationName"',
  );

  const failures = validateContractContract(schema, stripped);
  assert.ok(
    failures.some((failure) => failure.includes('preflight')),
    `expected a missing-preflight failure, got: ${failures.join('; ')}`,
  );
});

test('contract validator rejects a preflight that runs after destructive DDL', () => {
  const { schema, migration } = loadContract();
  const late = `${migration}\nRAISE EXCEPTION 'late preflight';\n`;

  const failures = validateContractContract(schema, late);
  assert.ok(
    failures.includes('a preflight gate runs after destructive DDL'),
    `expected a late-preflight failure, got: ${failures.join('; ')}`,
  );
});

test('contract validator rejects a missing RoleRequest rename', () => {
  const { schema, migration } = loadContract();
  const stripped = migration.replace(
    'ALTER TABLE "RoleRequest" RENAME TO "StaffAccessRequest";',
    '',
  );

  const failures = validateContractContract(schema, stripped);
  assert.ok(
    failures.some((failure) => failure.includes('RoleRequest')),
    `expected a missing-rename failure, got: ${failures.join('; ')}`,
  );
});

test('contract validator rejects a missing User mirror drop', () => {
  const { schema, migration } = loadContract();
  const stripped = migration
    .replace('DROP COLUMN "name",', '')
    .replace('DROP COLUMN "studentId",', '')
    .replace('DROP COLUMN "department";', '');

  const failures = validateContractContract(schema, stripped);
  assert.ok(
    failures.some((failure) => /name|studentId|department/.test(failure)),
    `expected a missing-mirror-drop failure, got: ${failures.join('; ')}`,
  );
});
