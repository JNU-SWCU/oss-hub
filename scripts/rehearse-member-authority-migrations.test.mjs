import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validateExpandContract } from './member-authority-expand-contract.mjs';

const migrationPath = new URL(
  '../apps/backend/prisma/migrations/20260821000000_add_member_authority_schema_expand/migration.sql',
  import.meta.url,
);
const schemaPath = new URL(
  '../apps/backend/prisma/schema.prisma',
  import.meta.url,
);
const rehearsalPath = new URL(
  './rehearse-member-authority-migrations.sh',
  import.meta.url,
);

test('expand schema and migration encode only nullable authority and affiliation additions', () => {
  // Given
  assert.equal(
    existsSync(migrationPath),
    true,
    'versioned expand migration is missing',
  );
  const schema = readFileSync(schemaPath, 'utf8');
  const migration = readFileSync(migrationPath, 'utf8');

  // When
  const executableSql = migration
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

  // Then — 이 검사는 **expand 마이그레이션 파일**만 잠근다. 그때의 스키마 모양은
  // 이후 릴리스가 계속 바꾸므로 여기서 요구하면 영원히 거짓이 된다. 지금 릴리스의
  // 스키마는 `member-authority-bridge-contract.mjs`가 따로 잠근다.
  assert.match(schema, /enum MemberKind \{\s+STUDENT\s+STAFF\s+\}/);
  assert.match(
    schema,
    /enum AffiliationKind \{\s+DEPARTMENT\s+PROGRAM_OFFICE\s+\}/,
  );
  assert.match(schema, /studentId\s+String\?\s+@unique/);
  assert.doesNotMatch(
    executableSql,
    /\b(?:UPDATE|DELETE|INSERT|CREATE TABLE|LOCK)\b/i,
  );
  assert.deepEqual(validateExpandContract(schema, migration), []);
});

test('expand rehearsal covers fresh apply, legacy upgrade, and legacy boot without psql', () => {
  // Given
  const rehearsal = readFileSync(rehearsalPath, 'utf8');

  // When
  const deployCount =
    rehearsal.match(/npx prisma migrate deploy/g)?.length ?? 0;

  // Then
  assert.equal(deployCount, 3);
  assert.match(rehearsal, /08419aec35492abd3a416795f091997dfbe1f712/);
  assert.match(rehearsal, /up -d fresh-db upgrade-db --wait/);
  assert.match(rehearsal, /up -d legacy-backend --wait/);
  assert.match(rehearsal, /api\/v1\/health/);
  assert.match(rehearsal, /api\/v1\/auth\/session/);
  assert.doesNotMatch(rehearsal, /\bpsql\b/);
});

test('expand contract rejects a non-null authority column', () => {
  // Given
  const schema = readFileSync(schemaPath, 'utf8');
  const migration = readFileSync(migrationPath, 'utf8').replace(
    'ADD COLUMN "hasStaffAccess" BOOLEAN,',
    'ADD COLUMN "hasStaffAccess" BOOLEAN NOT NULL DEFAULT false,',
  );

  // When
  const issues = validateExpandContract(schema, migration);

  // Then
  assert.deepEqual(issues, ['migration:unexpected-statements']);
});

test('expand contract rejects data mutation', () => {
  // Given
  const schema = readFileSync(schemaPath, 'utf8');
  const migration = `${readFileSync(migrationPath, 'utf8')}\nUPDATE "User" SET "hasStaffAccess" = false;\n`;

  // When
  const issues = validateExpandContract(schema, migration);

  // Then
  assert.deepEqual(issues, ['migration:unexpected-statements']);
});
