import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validateContractContract } from './member-authority-contract-contract.mjs';
import {
  EXCLUDE_PATTERNS,
  isScannedSource,
} from './member-authority-contract-sources.mjs';

const schemaPath = new URL(
  '../apps/backend/prisma/schema.prisma',
  import.meta.url,
);
const migrationPath = new URL(
  '../apps/backend/prisma/migrations/20260824000000_contract_member_authority/migration.sql',
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

/**
 * 아래는 참조 트리보다 **더 넓은** 게이트다. 참조 구현은 미분류 관리자·학번 유일성·
 * 알 수 없는 상태·끊긴 원장을 세지 않았다 — 넷 다 파괴적 DDL 뒤에 발견하면 되돌릴
 * 근거가 남지 않는 부류라 검사기가 그 부재를 직접 거절해야 한다.
 */
test('contract validator rejects a missing unresolved-ADMIN gate', () => {
  const { schema, migration } = loadContract();
  const stripped = migration.replace(
    /u\."role" = 'ADMIN' AND \(p\."userId" IS NULL OR p\."memberKind" IS NULL\)/,
    'u."role" = \'ADMIN\'',
  );

  const failures = validateContractContract(schema, stripped);
  assert.ok(
    failures.some((failure) => failure.includes('preflight')),
    `expected a missing-ADMIN-gate failure, got: ${failures.join('; ')}`,
  );
});

test('contract validator rejects a missing student-id uniqueness gate', () => {
  const { schema, migration } = loadContract();
  const stripped = migration.replace(
    'GROUP BY "studentId" HAVING count(*) > 1',
    'GROUP BY "studentId"',
  );

  const failures = validateContractContract(schema, stripped);
  assert.ok(
    failures.some((failure) => failure.includes('preflight')),
    `expected a missing-uniqueness-gate failure, got: ${failures.join('; ')}`,
  );
});

test('contract validator rejects a missing unknown-status gate', () => {
  const { schema, migration } = loadContract();
  const stripped = migration.replace(
    /"status"::text NOT IN \('PENDING', 'APPROVED', 'REJECTED', 'REVOKED'\)/,
    'FALSE',
  );

  const failures = validateContractContract(schema, stripped);
  assert.ok(
    failures.some((failure) => failure.includes('preflight')),
    `expected a missing-status-gate failure, got: ${failures.join('; ')}`,
  );
});

test('contract validator rejects a missing migration-ledger gate', () => {
  const { schema, migration } = loadContract();
  const stripped = migration.replace(
    '"finished_at" IS NULL OR "rolled_back_at" IS NOT NULL',
    'FALSE',
  );

  const failures = validateContractContract(schema, stripped);
  assert.ok(
    failures.some((failure) => failure.includes('preflight')),
    `expected a missing-ledger-gate failure, got: ${failures.join('; ')}`,
  );
});

test('contract validator rejects a surviving bridge-only @@map', () => {
  const { schema, migration } = loadContract();
  // bridge는 정본 이름을 옛 물리 이름 위에 얹었다. 개명이 끝난 뒤 그 이음매가
  // 남아 있으면 Prisma가 존재하지 않는 테이블을 가리킨다.
  const mapped = schema.replace(
    'model StaffAccessRequest {',
    'model StaffAccessRequest {\n  @@map("RoleRequest")',
  );

  const failures = validateContractContract(mapped, migration);
  assert.ok(
    failures.some((failure) => failure.includes('@@map')),
    `expected an @@map failure, got: ${failures.join('; ')}`,
  );
});

test('contract validator flags production sources that resurrect dropped physical names', () => {
  const { schema, migration } = loadContract();
  const sources = [
    {
      path: 'apps/backend/src/synthetic.ts',
      contents: 'const q = `SELECT 1 FROM "RoleRequest"`;\n',
    },
  ];

  const failures = validateContractContract(schema, migration, sources);
  assert.ok(
    failures.some((failure) =>
      failure.includes('apps/backend/src/synthetic.ts'),
    ),
    `expected a source failure, got: ${failures.join('; ')}`,
  );
});

test('contract source policy does not silently broaden its exclusion', () => {
  // 제외 규칙은 정확히 둘(spec·test)이다. 늘어나면 검사가 보는 면적만 조용히 줄어든다.
  assert.equal(EXCLUDE_PATTERNS.length, 2);
  assert.equal(
    isScannedSource('apps/backend/src/users/users.service.ts'),
    true,
  );
  assert.equal(
    isScannedSource('apps/backend/src/users/canonical-user-fixture.ts'),
    true,
    'fixtures are scanned — an unscanned file can carry a real violation unnoticed',
  );
  assert.equal(isScannedSource('apps/backend/src/users/users.spec.ts'), false);
});
