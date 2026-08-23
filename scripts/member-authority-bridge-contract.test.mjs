import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validateBridgeContract } from './member-authority-bridge-contract.mjs';

const migrationPath = new URL(
  '../apps/backend/prisma/migrations/20260823000000_bridge_member_authority/migration.sql',
  import.meta.url,
);
const schemaPath = new URL(
  '../apps/backend/prisma/schema.prisma',
  import.meta.url,
);
const rehearsalPath = new URL(
  './rehearse-member-authority-bridge.sh',
  import.meta.url,
);

function readSchema() {
  return readFileSync(schemaPath, 'utf8');
}

function readMigration() {
  return readFileSync(migrationPath, 'utf8');
}

test('bridge migration and schema keep the previous image readable', () => {
  // Given
  assert.equal(
    existsSync(migrationPath),
    true,
    'versioned bridge migration is missing',
  );

  // When
  const failures = validateBridgeContract(readSchema(), readMigration());

  // Then
  assert.deepEqual(failures, []);
});

test('bridge contract rejects any destructive DDL', () => {
  // Given — 파괴적 DDL은 하나라도 있으면 롤백이 불가능해진다.
  const destructive = [
    ['DROP COLUMN "role";', 'a column drop'],
    ['DROP TABLE "RoleRequest";', 'a table drop'],
    ['DROP TYPE "Role";', 'a type drop'],
    ['ALTER TABLE "RoleRequest" RENAME TO "StaffAccessRequest";', 'a rename'],
  ];

  for (const [statement, label] of destructive) {
    // When
    const failures = validateBridgeContract(
      readSchema(),
      `${readMigration()}\n${statement}\n`,
    );

    // Then
    assert.ok(
      failures.includes(`bridge migration contains ${label}`),
      `expected the checker to reject ${label}`,
    );
  }
});

test('bridge contract rejects a NOT NULL lock on the canonical profile columns', () => {
  // Given — 직전 이미지는 이 세 칸을 쓰지 않으므로 NOT NULL은 그 이미지의 가입을 막는다.
  const columns = ['memberKind', 'affiliationKind', 'affiliationName'];

  for (const column of columns) {
    // When
    const failures = validateBridgeContract(
      readSchema(),
      `${readMigration()}\nALTER TABLE "UserProfile" ALTER COLUMN "${column}" SET NOT NULL;\n`,
    );

    // Then
    assert.ok(
      failures.includes(
        `bridge migration contains a NOT NULL lock on UserProfile.${column}`,
      ),
      `expected the checker to reject a NOT NULL lock on ${column}`,
    );
  }
});

test('bridge contract rejects NOT NULL that runs before DEFAULT FALSE', () => {
  // Given — DEFAULT가 먼저 서지 않으면 직전 이미지의 가입 INSERT가 NOT NULL에 걸린다.
  const migration = [
    'ALTER TABLE "User" ALTER COLUMN "hasStaffAccess" SET NOT NULL;',
    'ALTER TABLE "User" ALTER COLUMN "hasAdminAccess" SET NOT NULL;',
    'ALTER TABLE "User" ALTER COLUMN "hasStaffAccess" SET DEFAULT FALSE;',
    'ALTER TABLE "User" ALTER COLUMN "hasAdminAccess" SET DEFAULT FALSE;',
  ].join('\n');

  // When
  const failures = validateBridgeContract(readSchema(), migration);

  // Then
  assert.ok(
    failures.includes(
      'bridge migration locks NOT NULL before it sets DEFAULT FALSE',
    ),
  );
});

test('bridge contract rejects a schema that drops the rollback surface', () => {
  // Given — 롤백에 필요한 잔존물이 하나라도 사라지면 직전 이미지가 붙지 못한다.
  const removals = [
    [
      /enum Role \{\n  STUDENT\n  STAFF\n  ADMIN\n\}\n\n/,
      'legacy Role enum retained for rollback',
    ],
    [/^\s+role\s+Role\?\n/m, 'legacy User.role retained for rollback'],
    [
      /^\s+selectedRole\s+Role\?\n/m,
      'legacy User.selectedRole retained for rollback',
    ],
    [/@@map\("RoleRequest"\)\n/, 'StaffAccessRequest @@map("RoleRequest")'],
    [
      /@@map\("RoleRequestStatus"\)\n/,
      'StaffAccessRequestStatus @@map("RoleRequestStatus")',
    ],
  ];

  for (const [pattern, label] of removals) {
    // When
    const failures = validateBridgeContract(
      readSchema().replace(pattern, ''),
      readMigration(),
    );

    // Then
    assert.ok(
      failures.includes(`schema is missing ${label}`),
      `expected the checker to demand ${label}`,
    );
  }
});

test('bridge contract rejects production code that reads legacy authority as truth', () => {
  // Given — 칸을 남겨 둔 이유는 오직 롤백이다. 읽는 순간 그것은 다시 정본이 된다.
  const sources = [
    [
      'src/auth/auth.repository.ts',
      'const S = { role: true };',
      'a Prisma select of User.role',
    ],
    [
      'src/auth/auth.repository.ts',
      'const S = { selectedRole: true };',
      'a Prisma select of User.selectedRole',
    ],
    [
      'src/roles/roles.repository.ts',
      'await prisma.roleRequest.findFirst({});',
      'a Prisma call on the legacy roleRequest model',
    ],
  ];

  for (const [path, contents, label] of sources) {
    // When
    const failures = validateBridgeContract(readSchema(), readMigration(), [
      { path, contents },
    ]);

    // Then
    assert.ok(
      failures.includes(`${path} contains ${label}`),
      `expected the checker to reject ${label}`,
    );
  }
});

test('bridge rehearsal boots both images against one schema', () => {
  // Given
  const rehearsal = readFileSync(rehearsalPath, 'utf8');

  // When
  const deployCount =
    rehearsal.match(/npx prisma migrate deploy/g)?.length ?? 0;

  // Then — 스키마는 **한 번만** 만든다. 두 이미지가 그 하나를 번갈아 쓴다는 것이 요점이다.
  assert.equal(deployCount, 1);
  assert.match(rehearsal, /197fd717833ea2ea5aceab6cf56ba02a57e93085/);
  assert.match(rehearsal, /previous_tag=v0\.6\.110/);
  assert.match(rehearsal, /up -d previous-backend --wait/);
  assert.match(rehearsal, /up -d bridge-backend --wait/);
  assert.match(rehearsal, /api\/v1\/health/);
  assert.match(rehearsal, /api\/v1\/auth\/session/);
  // 인증 가드가 fail-closed인지 확인하는 단계가 있어야 한다.
  assert.match(rehearsal, /expected 401/);
  assert.doesNotMatch(rehearsal, /\bpsql\b/);
});
