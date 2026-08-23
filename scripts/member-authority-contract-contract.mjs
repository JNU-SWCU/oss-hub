#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * 계약(contract) 마이그레이션이 반드시 담아야 하는 문장들.
 *
 * 정확한 SQL 문자열이 아니라 **패턴**으로 잠근다 — 이 단계의 계약은 "무엇을 지우고
 * 무엇을 잠그는가"이지 그 문장의 표기가 아니기 때문이다. 다만 파괴적 DDL과 개명은
 * 하나라도 빠지면 롤백이 불가능해지므로 개별로 잠근다.
 */
const REQUIRED_MIGRATION_PATTERNS = [
  // 개명은 데이터를 복사하지 않는다 — 행·id·상태가 그대로 이어져야 한다.
  /ALTER TYPE "RoleRequestStatus" RENAME TO "StaffAccessRequestStatus"/,
  /ALTER TABLE "RoleRequest" RENAME TO "StaffAccessRequest"/,
  /ALTER INDEX "RoleRequest_userId_pending_key"\s+RENAME TO "StaffAccessRequest_userId_pending_key"/,
  // canonical 칸 잠금
  /ALTER COLUMN "hasStaffAccess" SET NOT NULL/,
  /ALTER COLUMN "hasAdminAccess" SET NOT NULL/,
  /ALTER COLUMN "memberKind" SET NOT NULL/,
  /ALTER COLUMN "affiliationKind" SET NOT NULL/,
  /ALTER COLUMN "affiliationName" SET NOT NULL/,
  // 저장 불변식
  /CONSTRAINT "UserProfile_department_affiliationName_check"/,
  /CONSTRAINT "UserProfile_studentId_memberKind_check"/,
  // legacy 제거
  /DROP COLUMN "role"/,
  /DROP COLUMN "selectedRole"/,
  /DROP TYPE "Role"/,
];

/**
 * 파괴적 DDL 앞에 반드시 서 있어야 하는 preflight 게이트.
 *
 * 하나라도 빠지면 어긋난 데이터 위에서 NOT NULL·CHECK가 터지고, 그때는 이미
 * legacy 칸이 사라진 뒤라 되돌릴 근거가 남지 않는다.
 */
const REQUIRED_PREFLIGHT_PATTERNS = [
  /UserProfile" WHERE "memberKind" IS NULL/,
  /"affiliationKind" IS NULL OR "affiliationName" IS NULL/,
  /"hasStaffAccess" IS NULL OR "hasAdminAccess" IS NULL/,
  /"department" IS DISTINCT FROM "affiliationName"/,
  /"memberKind" = 'STAFF' AND "studentId" IS NOT NULL/,
  /"memberKind" = 'STUDENT'\s*\n?\s*AND \("studentId" IS NULL OR "studentId" !~ '\^\[0-9\]\{6,10\}\$'\)/,
];

/** 계약 이후 schema.prisma가 반드시 만족해야 하는 모양. */
const REQUIRED_SCHEMA_PATTERNS = [
  /model StaffAccessRequest \{/,
  /enum StaffAccessRequestStatus \{/,
  /selectedMemberKind\s+MemberKind\?/,
  /hasStaffAccess\s+Boolean\s+@default\(false\)/,
  /hasAdminAccess\s+Boolean\s+@default\(false\)/,
  /memberKind\s+MemberKind\n/,
  /affiliationKind\s+AffiliationKind\n/,
  /affiliationName\s+String\s/,
];

/** 계약 이후 schema.prisma에 **남아 있으면 안 되는** 것. */
const FORBIDDEN_SCHEMA_PATTERNS = [
  [/enum Role \{/, 'legacy Role enum'],
  [/\brole\s+Role\?/, 'User.role'],
  [/selectedRole\s+Role\?/, 'User.selectedRole'],
  [/model RoleRequest \{/, 'RoleRequest model'],
  [/enum RoleRequestStatus \{/, 'RoleRequestStatus enum'],
];

export function validateContractContract(schema, migrationSql) {
  const failures = [];

  for (const pattern of REQUIRED_MIGRATION_PATTERNS) {
    if (!pattern.test(migrationSql)) {
      failures.push(`migration is missing required statement: ${pattern}`);
    }
  }
  for (const pattern of REQUIRED_PREFLIGHT_PATTERNS) {
    if (!pattern.test(migrationSql)) {
      failures.push(`migration is missing required preflight gate: ${pattern}`);
    }
  }
  for (const pattern of REQUIRED_SCHEMA_PATTERNS) {
    if (!pattern.test(schema)) {
      failures.push(`schema is missing required shape: ${pattern}`);
    }
  }
  for (const [pattern, label] of FORBIDDEN_SCHEMA_PATTERNS) {
    if (pattern.test(schema)) {
      failures.push(`schema still contains ${label}`);
    }
  }

  // 모든 preflight는 파괴적 DDL보다 **앞에** 있어야 한다.
  const firstDrop = migrationSql.search(/DROP COLUMN|DROP TYPE|SET NOT NULL/);
  const lastPreflight = migrationSql.lastIndexOf('RAISE EXCEPTION');
  if (firstDrop >= 0 && lastPreflight >= 0 && lastPreflight > firstDrop) {
    failures.push('a preflight gate runs after destructive DDL');
  }

  return failures;
}

function main() {
  const [schemaPath, migrationPath] = process.argv.slice(2);
  if (!schemaPath || !migrationPath) {
    process.stderr.write(
      'Usage: member-authority-contract-contract.mjs <schema.prisma> <migration.sql>\n',
    );
    process.exit(2);
  }
  const failures = validateContractContract(
    readFileSync(schemaPath, 'utf8'),
    readFileSync(migrationPath, 'utf8'),
  );
  if (failures.length > 0) {
    for (const failure of failures) {
      process.stderr.write(`contract violation: ${failure}\n`);
    }
    process.exit(1);
  }
  process.stdout.write('{"status":"ok","scenario":"contract-contract"}\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
