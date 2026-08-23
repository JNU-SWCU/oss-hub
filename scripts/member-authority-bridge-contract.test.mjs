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
const upgradeRehearsalPath = new URL(
  './rehearse-member-authority-bridge-upgrade.sh',
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
      'bridge migration locks hasStaffAccess NOT NULL before it sets DEFAULT FALSE',
    ),
  );
  assert.ok(
    failures.includes(
      'bridge migration locks hasAdminAccess NOT NULL before it sets DEFAULT FALSE',
    ),
  );
});

test('bridge contract rejects an access-flag backfill without COALESCE', () => {
  // Given — SQL 3값 논리에서 `NULL IN (...)`는 FALSE가 아니라 NULL이다. 역할이
  // 없는 계정(가입 직후·회수 이후)이 그대로 NULL로 남아 SET NOT NULL이 터진다.
  // 빈 테이블에서는 재현되지 않아 정적 검사가 따로 잡아야 하는 결함이다.
  const withoutCoalesce = readMigration()
    .replace(
      `SET "hasStaffAccess" = COALESCE(("role" IN ('STAFF', 'ADMIN')), FALSE)`,
      `SET "hasStaffAccess" = ("role" IN ('STAFF', 'ADMIN'))`,
    )
    .replace(
      `SET "hasAdminAccess" = COALESCE(("role" = 'ADMIN'), FALSE)`,
      `SET "hasAdminAccess" = ("role" = 'ADMIN')`,
    );

  // When
  const failures = validateBridgeContract(readSchema(), withoutCoalesce);

  // Then
  assert.equal(
    failures.filter((failure) =>
      failure.startsWith('bridge migration is missing required statement'),
    ).length,
    2,
  );
});

test('bridge contract rejects an ADMIN-derived member kind', () => {
  // Given — 권한과 정체성은 독립이다. 삭제된 원본 backfill의
  // `projectUnresolvedAdmin`도 관리자의 세 칸을 null로 남겼다.
  const inferences = [
    ["WHEN 'ADMIN' THEN 'STAFF'", 'an ADMIN=>STAFF member kind inference'],
    ["WHEN 'ADMIN' THEN 'STUDENT'", 'an ADMIN=>STUDENT member kind inference'],
  ];

  for (const [clause, label] of inferences) {
    // When
    const migration = readMigration().replace(
      `SET "memberKind" = CASE u."role"`,
      `SET "memberKind" = CASE u."role"\n    ${clause}`,
    );
    const failures = validateBridgeContract(readSchema(), migration);

    // Then
    assert.ok(
      failures.includes(`bridge migration contains ${label}`),
      `expected the checker to reject ${label}`,
    );
  }
});

test('bridge contract requires the canonical profile backfill', () => {
  // Given — 이 backfill이 없으면 다음 contract 마이그레이션의 preflight가
  // 비어 있는 `memberKind` 행에서 배포를 멈췠 세운다.
  const removals = [
    /UPDATE "UserProfile" AS p\n\s*SET "memberKind"[^;]*;/s,
    /UPDATE "UserProfile"\n\s*SET "affiliationName" = "department"[^;]*;/s,
    /UPDATE "UserProfile"\n\s*SET "affiliationKind"[^;]*;/s,
  ];

  for (const pattern of removals) {
    // When
    const failures = validateBridgeContract(
      readSchema(),
      readMigration().replace(pattern, ''),
    );

    // Then
    assert.ok(
      failures.some((failure) =>
        failure.startsWith('bridge migration is missing required statement'),
      ),
      `expected the checker to demand ${pattern}`,
    );
  }
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

test('bridge upgrade rehearsal seeds rows before the migration runs', () => {
  // Given — 호환 레인은 빈 테이블에 `migrate deploy`를 돌려 backfill이 0행을
  // 건드린다. 그 레인만 보면 backfill 결함이 통과하므로, 업그레이드 레인은
  // 반드시 **행을 먼저 심고** 마이그레이션을 돌려야 한다.
  const upgrade = readFileSync(upgradeRehearsalPath, 'utf8');

  // When — 스테이징 트리(bridge 제외) 적용 → seed → 진짜 마이그레이션 순서다.
  const stagedDeployAt = upgrade.indexOf('--schema "$staged/schema.prisma"');
  const seedAt = upgrade.indexOf('seed_rows');
  const realDeployAt = upgrade.indexOf(
    'pnpm exec prisma migrate deploy >/dev/null)',
  );

  // Then
  assert.ok(stagedDeployAt >= 0 && seedAt >= 0 && realDeployAt >= 0);
  assert.ok(
    stagedDeployAt < seedAt && seedAt < realDeployAt,
    'upgrade rehearsal must seed rows between the staged apply and the bridge migration',
  );
  // role NULL 행이 실제로 심기는지 — 이 행이 결함을 잡는다.
  assert.match(upgrade, /upgrade-unassigned/);
  // negative 레인이 COALESCE를 걷어내고 실패를 요구하는지.
  assert.match(upgrade, /unexpectedly succeeded on NULL role rows/);
  assert.doesNotMatch(upgrade, /\.skip\(|TODO/);
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
