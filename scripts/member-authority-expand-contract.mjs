#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EXPECTED_SQL = [
  `CREATE TYPE "MemberKind" AS ENUM ('STUDENT', 'STAFF')`,
  `CREATE TYPE "AffiliationKind" AS ENUM ('DEPARTMENT', 'PROGRAM_OFFICE')`,
  `ALTER TABLE "User" ADD COLUMN "selectedMemberKind" "MemberKind", ADD COLUMN "hasStaffAccess" BOOLEAN, ADD COLUMN "hasAdminAccess" BOOLEAN`,
  `ALTER TABLE "UserProfile" ALTER COLUMN "studentId" DROP NOT NULL, ADD COLUMN "memberKind" "MemberKind", ADD COLUMN "affiliationKind" "AffiliationKind", ADD COLUMN "affiliationName" TEXT`,
];

/**
 * 이 검사는 **expand 마이그레이션 SQL만** 잠근다.
 *
 * 예전에는 그때의 `schema.prisma` 모양까지 함께 검사했다. 그 뒤로 스키마는 계속
 * 움직이는데(bridge가 접근 권한 두 칸을 잠그고, 다음 contract PR이 legacy Role을 지운다)
 * expand 마이그레이션 **파일 자체**는 이미 적용돼 다시는 바뀌지 않는다. 그래서 지나간
 * 릴리스의 스키마 모양을 여기서 요구하면 그 단언은 영원히 거짓이 된다 — 이 검사가
 * 지켜야 하는 것은 그 파일의 내용뿐이다. 지금 릴리스의 스키마 모양은
 * `member-authority-bridge-contract.mjs`가 따로 잠근다.
 */

function normalizeStatement(statement) {
  return statement.replace(/\s+/g, ' ').trim();
}

function executableStatements(sql) {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map(normalizeStatement)
    .filter((statement) => statement.length > 0);
}

export function validateExpandContract(_schema, migrationSql) {
  const issues = [];
  const statements = executableStatements(migrationSql);
  if (
    statements.length !== EXPECTED_SQL.length ||
    statements.some((statement, index) => statement !== EXPECTED_SQL[index])
  ) {
    issues.push('migration:unexpected-statements');
  }
  return issues;
}

function main() {
  const schemaPath = process.argv[2];
  const migrationPath = process.argv[3];
  if (schemaPath === undefined || migrationPath === undefined) {
    process.stderr.write(
      'Usage: node scripts/member-authority-expand-contract.mjs <schema.prisma> <migration.sql>\n',
    );
    process.exitCode = 2;
    return;
  }

  const issues = validateExpandContract(
    readFileSync(schemaPath, 'utf8'),
    readFileSync(migrationPath, 'utf8'),
  );
  if (issues.length > 0) {
    process.stderr.write(`${JSON.stringify({ status: 'rejected', issues })}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${JSON.stringify({ status: 'ok' })}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
