#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function quote(value) {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function bool(value) {
  return value ? 'TRUE' : 'FALSE';
}

function buildSeedSql(fixture) {
  const statements = [];

  for (const user of fixture.users) {
    statements.push(
      `INSERT INTO "User" (id, "githubId", login, "accountStatus", role, "selectedRole", ` +
        `"selectedMemberKind", "hasStaffAccess", "hasAdminAccess", name, "studentId", department, ` +
        `"createdAt", "updatedAt") VALUES (` +
        [
          quote(user.id),
          user.githubId,
          quote(user.nickname),
          `${quote(user.accountStatus)}::"AccountStatus"`,
          user.role === null ? 'NULL' : `${quote(user.role)}::"Role"`,
          user.selectedRole === null
            ? 'NULL'
            : `${quote(user.selectedRole)}::"Role"`,
          user.selectedMemberKind === null
            ? 'NULL'
            : `${quote(user.selectedMemberKind)}::"MemberKind"`,
          bool(user.hasStaffAccess),
          bool(user.hasAdminAccess),
          quote(user.name),
          quote(user.studentId),
          quote(user.department),
          'now()',
          'now()',
        ].join(', ') +
        ');',
    );
  }

  for (const user of fixture.users) {
    if (!user.profile) {
      continue;
    }
    const profile = user.profile;
    statements.push(
      `INSERT INTO "UserProfile" ("userId", name, "studentId", department, ` +
        `"memberKind", "affiliationKind", "affiliationName", "createdAt", "updatedAt") VALUES (` +
        [
          quote(user.id),
          quote(profile.name),
          quote(profile.studentId),
          quote(profile.department),
          `${quote(profile.memberKind)}::"MemberKind"`,
          `${quote(profile.affiliationKind)}::"AffiliationKind"`,
          quote(profile.affiliationName),
          'now()',
          'now()',
        ].join(', ') +
        ');',
    );
  }

  for (const request of fixture.requests) {
    statements.push(
      `INSERT INTO "RoleRequest" (id, "userId", status, "rejectionReason", ` +
        `"decidedById", "decidedAt", "createdAt", "updatedAt") VALUES (` +
        [
          quote(request.id),
          quote(request.userId),
          `${quote(request.status)}::"RoleRequestStatus"`,
          quote(request.rejectionReason),
          quote(request.decidedById),
          quote(request.decidedAt),
          quote(request.createdAt),
          quote(request.updatedAt),
        ].join(', ') +
        ');',
    );
  }

  return `BEGIN;\n${statements.join('\n')}\nCOMMIT;\n`;
}

function main() {
  const [fixturePath] = process.argv.slice(2);
  if (!fixturePath) {
    process.stderr.write(
      'Usage: member-authority-contract-seed.mjs <fixture.json>\n',
    );
    process.exit(2);
  }
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  process.stdout.write(buildSeedSql(fixture));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
