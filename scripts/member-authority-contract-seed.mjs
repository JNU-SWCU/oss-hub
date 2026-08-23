#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * 계약 리허설이 심을 합성 행을 SQL로 낸다.
 *
 * 리허설은 **계약 마이그레이션 직전** 스키마 위에서 돈다. 그 시점의 Prisma 클라이언트는
 * 계약 이후 모양으로 생성되어 있어 legacy 칸을 쓸 수 없으므로, 여기서는 클라이언트를
 * 쓰지 않고 SQL을 직접 낸다.
 *
 * 값은 전부 합성이다 — 픽스처 파일에 실제 사용자 데이터가 없다.
 */

function quote(value) {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function bool(value) {
  return value ? 'TRUE' : 'FALSE';
}

export function buildSeedSql(fixture) {
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
