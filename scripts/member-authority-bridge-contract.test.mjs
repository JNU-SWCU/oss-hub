import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validateBridgeContract } from './member-authority-bridge-contract.mjs';
import {
  EXCLUDE_PATTERNS,
  isScannedSource,
} from './member-authority-bridge-sources.mjs';

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

/**
 * 실제 소스 스캔 정책.
 *
 * 검사기가 아무리 정확해도 훑는 면이 좁으면 회귀가 그대로 통과한다. 그래서 포함·제외
 * 정책 자체를 잠근다 — 특히 제외가 조용히 넓어지는 것을 막는다.
 */
test('source policy includes production code and excludes only justified files', () => {
  // Given / When / Then — 생산 코드는 반드시 들어온다.
  for (const included of [
    'apps/backend/src/auth/auth.repository.ts',
    'apps/backend/src/users/admin-access-read-ordering.ts',
    'apps/backend/prisma/seeds/oss-hub.ts',
  ]) {
    assert.equal(
      isScannedSource(included),
      true,
      `${included} must be scanned`,
    );
  }

  // 테스트만 빠진다.
  for (const excluded of [
    'apps/backend/src/users/admin-access-read.repository.spec.ts',
    'apps/backend/src/users/admin-access-read.integration.spec.ts',
    'scripts/member-authority-bridge-contract.test.ts',
  ]) {
    assert.equal(
      isScannedSource(excluded),
      false,
      `${excluded} must be excluded`,
    );
  }

  // 저장소 밖·다른 확장자는 애초에 대상이 아니다.
  assert.equal(isScannedSource('apps/frontend/src/lib/api-client.ts'), false);
  assert.equal(isScannedSource('apps/backend/src/main.js'), false);
});

test('source policy does not silently broaden the exclusion', () => {
  // Given — 픽스처·지원 모듈이라는 이유만으로 빠지면 검사 면적이 조용히 줄어든다.
  // 지금 그 파일들은 legacy 모양을 담고 있지 않으므로 제외할 근거가 없다.
  for (const stillScanned of [
    'apps/backend/src/auth/auth-route-inventory.fixture.ts',
    'apps/backend/src/users/canonical-user-fixture.ts',
    'apps/backend/src/users/admin-access.http.integration-support.ts',
    // 직전 프런트엔드 계약을 옮겨 둔 픽스처조차 제외하지 않는다 — 그 파일의
    // legacy 철자는 HTTP 필드 이름이라 Prisma 접근 패턴에 걸리지 않는다.
    'apps/backend/src/users/previous-frontend-contract.fixture.ts',
  ]) {
    assert.equal(
      isScannedSource(stillScanned),
      true,
      `${stillScanned} must stay in the scan set`,
    );
  }

  // 제외 규칙은 정확히 둘(spec·test)이다. 늘어나면 이 단언이 먼저 깨진다.
  assert.equal(EXCLUDE_PATTERNS.length, 2);
});

test('the vendored previous-frontend fixture stays scannable', () => {
  // Given — 이 픽스처는 직전 번들의 코드를 그대로 옮겨 와 `roleRequestPage` 같은
  // legacy 철자를 담는다. 그러나 그것은 **HTTP 필드 이름**이지 Prisma 접근이 아니다.
  const fixture = readFileSync(
    new URL(
      '../apps/backend/src/users/previous-frontend-contract.fixture.ts',
      import.meta.url,
    ),
    'utf8',
  );
  const path = 'apps/backend/src/users/previous-frontend-contract.fixture.ts';

  // When
  const failures = validateBridgeContract(readSchema(), readMigration(), [
    { path, contents: fixture },
  ]);

  // Then — 걸리지 않으므로 제외할 이유가 없다. 제외 목록에 올려 두면 이 파일이
  // 나중에 진짜 위반을 담게 되어도 아무도 모른다.
  assert.deepEqual(failures, []);
  assert.equal(isScannedSource(path), true);
});
