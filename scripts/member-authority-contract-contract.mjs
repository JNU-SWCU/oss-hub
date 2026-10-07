#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REQUIRED_MIGRATION_PATTERNS = [
  /ALTER TYPE "RoleRequestStatus" RENAME TO "StaffAccessRequestStatus"/,
  /ALTER TABLE "RoleRequest" RENAME TO "StaffAccessRequest"/,
  /ALTER INDEX "RoleRequest_userId_pending_key"\s+RENAME TO "StaffAccessRequest_userId_pending_key"/,

  /ALTER COLUMN "hasStaffAccess" SET NOT NULL/,
  /ALTER COLUMN "hasAdminAccess" SET NOT NULL/,
  /ALTER COLUMN "memberKind" SET NOT NULL/,
  /ALTER COLUMN "affiliationKind" SET NOT NULL/,
  /ALTER COLUMN "affiliationName" SET NOT NULL/,

  /CONSTRAINT "UserProfile_department_affiliationName_check"/,
  /CONSTRAINT "UserProfile_studentId_memberKind_check"/,

  /DROP COLUMN "role"/,
  /DROP COLUMN "selectedRole"/,
  /DROP COLUMN "name"/,
  /DROP COLUMN "studentId"/,
  /DROP COLUMN "department"/,
  /DROP TYPE "Role"/,
];

const REQUIRED_PREFLIGHT_PATTERNS = [
  /"finished_at" IS NULL OR "rolled_back_at" IS NOT NULL/,

  /UserProfile" WHERE "memberKind" IS NULL/,
  /"affiliationKind" IS NULL OR "affiliationName" IS NULL/,
  /"hasStaffAccess" IS NULL OR "hasAdminAccess" IS NULL/,

  /u\."role" = 'ADMIN' AND \(p\."userId" IS NULL OR p\."memberKind" IS NULL\)/,

  /btrim\("name"\) <> "name"/,
  /btrim\("department"\) <> "department"/,
  /btrim\("affiliationName"\) <> "affiliationName"/,
  /btrim\("name"\) = ''/,

  /"department" IS DISTINCT FROM "affiliationName"/,

  /"memberKind" = 'STAFF' AND "studentId" IS NOT NULL/,
  /"memberKind" = 'STUDENT'\s*\n?\s*AND \("studentId" IS NULL OR "studentId" !~ '\^\[0-9\]\{6,10\}\$'\)/,

  /GROUP BY "studentId" HAVING count\(\*\) > 1/,

  /"status"::text NOT IN \('PENDING', 'APPROVED', 'REJECTED', 'REVOKED'\)/,

  /GROUP BY "userId" HAVING count\(\*\) > 1/,
];

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

const FORBIDDEN_SCHEMA_PATTERNS = [
  [/enum Role \{/, 'legacy Role enum'],
  [/\brole\s+Role\?/, 'User.role'],
  [/selectedRole\s+Role\?/, 'User.selectedRole'],
  [/model RoleRequest \{/, 'RoleRequest model'],
  [/enum RoleRequestStatus \{/, 'RoleRequestStatus enum'],

  [/@@map\("RoleRequest"\)/, 'bridge-only @@map("RoleRequest")'],
  [/@@map\("RoleRequestStatus"\)/, 'bridge-only @@map("RoleRequestStatus")'],
];

const FORBIDDEN_SOURCE_PATTERNS = [
  [
    /\bselectedRole\s*:\s*true\b/,
    'a Prisma select of the dropped User.selectedRole',
  ],
  [/\brole\s*:\s*true\b/, 'a Prisma select of the dropped User.role'],
  [/\bprisma\.roleRequest\b/, 'a Prisma call on the renamed roleRequest model'],
  [
    /\.roleRequest\.(?:find|create|update|delete|count)/,
    'a query against the renamed roleRequest model',
  ],

  [
    /FROM\s+"RoleRequest"/,
    'a raw SQL reference to the dropped physical name "RoleRequest"',
  ],
  [
    /::"RoleRequestStatus"/,
    'a raw SQL cast to the dropped physical type "RoleRequestStatus"',
  ],
  [
    /staff-access-request-physical-names/,
    'an import of the removed bridge-only physical-name module',
  ],
];

export function validateContractContract(
  schema,
  migrationSql,
  sourceFiles = [],
) {
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

  const firstDrop = migrationSql.search(/DROP COLUMN|DROP TYPE|SET NOT NULL/);
  const lastPreflight = migrationSql.lastIndexOf('RAISE EXCEPTION');
  if (firstDrop >= 0 && lastPreflight >= 0 && lastPreflight > firstDrop) {
    failures.push('a preflight gate runs after destructive DDL');
  }

  for (const { path, contents } of sourceFiles) {
    for (const [pattern, label] of FORBIDDEN_SOURCE_PATTERNS) {
      if (pattern.test(contents)) {
        failures.push(`${path} contains ${label}`);
      }
    }
  }

  return failures;
}

function main() {
  const [schemaPath, migrationPath, ...sourcePaths] = process.argv.slice(2);
  if (!schemaPath || !migrationPath) {
    process.stderr.write(
      'Usage: member-authority-contract-contract.mjs <schema.prisma> <migration.sql> [source.ts...]\n',
    );
    process.exit(2);
  }
  const failures = validateContractContract(
    readFileSync(schemaPath, 'utf8'),
    readFileSync(migrationPath, 'utf8'),
    sourcePaths.map((path) => ({
      path,
      contents: readFileSync(path, 'utf8'),
    })),
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
