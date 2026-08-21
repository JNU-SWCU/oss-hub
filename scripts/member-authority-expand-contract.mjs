#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EXPECTED_SQL = [
  `CREATE TYPE "MemberKind" AS ENUM ('STUDENT', 'STAFF')`,
  `CREATE TYPE "AffiliationKind" AS ENUM ('DEPARTMENT', 'PROGRAM_OFFICE')`,
  `ALTER TABLE "User" ADD COLUMN "selectedMemberKind" "MemberKind", ADD COLUMN "hasStaffAccess" BOOLEAN, ADD COLUMN "hasAdminAccess" BOOLEAN`,
  `ALTER TABLE "UserProfile" ALTER COLUMN "studentId" DROP NOT NULL, ADD COLUMN "memberKind" "MemberKind", ADD COLUMN "affiliationKind" "AffiliationKind", ADD COLUMN "affiliationName" TEXT`,
];

const REQUIRED_SCHEMA_PATTERNS = [
  /enum MemberKind \{\s+STUDENT\s+STAFF\s+\}/,
  /enum AffiliationKind \{\s+DEPARTMENT\s+PROGRAM_OFFICE\s+\}/,
  /selectedMemberKind\s+MemberKind\?/,
  /hasStaffAccess\s+Boolean\?/,
  /hasAdminAccess\s+Boolean\?/,
  /memberKind\s+MemberKind\?/,
  /affiliationKind\s+AffiliationKind\?/,
  /affiliationName\s+String\?/,
  /studentId\s+String\?\s+@unique/,
  /enum Role \{\s+STUDENT\s+STAFF\s+ADMIN\s+\}/,
  /selectedRole\s+Role\?/,
];

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

export function validateExpandContract(schema, migrationSql) {
  const issues = [];
  for (const pattern of REQUIRED_SCHEMA_PATTERNS) {
    if (!pattern.test(schema)) {
      issues.push(`schema:${pattern.source}`);
    }
  }

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
