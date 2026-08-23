#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * bridge 릴리스의 정적 계약.
 *
 * 이 단계가 지켜야 하는 것은 한 문장이다 — **정본 애플리케이션 동작을 전부 배포하되
 * 물리 스키마는 직전 이미지(v0.6.110 / base 41b101b7)가 그대로 읽고 쓸 수 있게 남긴다.**
 *
 * 그래서 검사는 두 방향으로 간다.
 *
 *   금지 — 파괴적 DDL이 bridge 마이그레이션에 단 한 줄도 없어야 한다. 하나라도 있으면
 *          직전 이미지로 되돌아갈 수 없고, 그 순간 이 릴리스는 bridge가 아니다.
 *   요구 — 정본 이름이 `@@map`으로 옛 물리 이름 위에 얹혀 있고, 롤백에 필요한 legacy
 *          칸·타입이 스키마에 남아 있어야 한다.
 */

/** bridge 마이그레이션에 **있으면 안 되는** 것 — 전부 되돌릴 수 없는 변경이다. */
const FORBIDDEN_MIGRATION_PATTERNS = [
  [/DROP\s+COLUMN/i, 'a column drop'],
  [/DROP\s+TABLE/i, 'a table drop'],
  [/DROP\s+TYPE/i, 'a type drop'],
  [/RENAME\s+TO/i, 'a rename'],
  // 정본 프로필 세 칸에 NOT NULL을 걸면 직전 이미지의 가입 완료가 전부 실패한다.
  [/"memberKind"\s+SET NOT NULL/i, 'a NOT NULL lock on UserProfile.memberKind'],
  [
    /"affiliationKind"\s+SET NOT NULL/i,
    'a NOT NULL lock on UserProfile.affiliationKind',
  ],
  [
    /"affiliationName"\s+SET NOT NULL/i,
    'a NOT NULL lock on UserProfile.affiliationName',
  ],
];

/**
 * bridge 마이그레이션이 반드시 담아야 하는 것.
 *
 * 접근 권한 두 칸만 잠근다. DEFAULT가 NOT NULL보다 **먼저** 서야 직전 이미지의
 * 가입 INSERT(두 칸 생략)가 계속 통과한다 — 순서까지 함께 잠근다.
 */
const REQUIRED_MIGRATION_PATTERNS = [
  // `COALESCE`는 장식이 아니다. SQL 3값 논리에서 `NULL IN (...)`는 FALSE가 아니라
  // NULL이라, 이게 빠지면 역할 없는 계정이 NULL로 남아 SET NOT NULL이 터진다.
  /UPDATE "User"\s*\n\s*SET "hasStaffAccess" = COALESCE\(\("role" IN \('STAFF', 'ADMIN'\)\), FALSE\)/,
  /UPDATE "User"\s*\n\s*SET "hasAdminAccess" = COALESCE\(\("role" = 'ADMIN'\), FALSE\)/,
  /ALTER COLUMN "hasStaffAccess" SET DEFAULT FALSE/,
  /ALTER COLUMN "hasAdminAccess" SET DEFAULT FALSE/,
  /ALTER COLUMN "hasStaffAccess" SET NOT NULL/,
  /ALTER COLUMN "hasAdminAccess" SET NOT NULL/,
  // 정본 프로필 세 칸을 기존 행에 채우는 backfill. 이게 없으면 다음 contract
  // 마이그레이션의 preflight가 비어 있는 `memberKind` 행에서 배포를 멈춰 세운다.
  /UPDATE "UserProfile" AS p\s*\n\s*SET "memberKind"/,
  // 소속명·소속 유형은 **회원 유형이 해소된 행에만** 채운다. 원본은 그 투영을
  // `requireMemberProfile` 안에서만 하므로, 미해소 행은 세 칸이 함께 null로 남는다.
  /SET "affiliationName" = "department"\s*\n\s*WHERE "affiliationName" IS NULL AND "memberKind" IS NOT NULL/,
  // 소속 유형의 기본값은 회원 유형과 무관하게 DEPARTMENT다.
  /SET "affiliationKind" = 'DEPARTMENT'::"AffiliationKind"\s*\n\s*WHERE "affiliationKind" IS NULL AND "memberKind" IS NOT NULL/,
];

/**
 * 교직원을 PROGRAM_OFFICE로 짐작하는 것은 원본에 없던 추정이다 — 원본은
 * `profile?.affiliationKind ?? DEPARTMENT` 하나뿐이고 회원 유형으로 갈라지지 않는다.
 */
const FORBIDDEN_MIGRATION_INFERENCE_PATTERNS = [
  [
    /SET "affiliationKind"[^;]*'PROGRAM_OFFICE'/s,
    'a STAFF=>PROGRAM_OFFICE affiliation inference',
  ],
];

/**
 * 정철자 비교를 위해 SQL 조각을 정규화한다.
 *
 * 이 검사가 잡아야 하는 것은 **의미**이지 표기가 아니다. 같은 추정을
 * `CASE u."role" WHEN 'ADMIN' THEN ...`으로도, `CASE WHEN u."role" = 'ADMIN' THEN ...`
 * 으로도, `"User"."role"`처럼 다른 자격자로도, `::"MemberKind"` 캡스트를 붙이거나
 * 빼고도 쓸 수 있다. 한 모양에만 말뜿을 박으면 나머지가 그대로 통과한다.
 *
 * 그래서 공백·자격자 접두·캡스트를 모두 걷어낸 뒤에 비교한다.
 */
function normalizeSql(sql) {
  return (
    stripComments(sql)
      // `"User"."role"` · `u."role"` · `p."memberKind"` → `"role"` · `"memberKind"`
      .replace(/(?:"[A-Za-z_][\w$]*"|\b[A-Za-z_][\w$]*)\s*\.\s*(")/g, '$1')
      // `'STAFF'::"MemberKind"` → `'STAFF'`
      .replace(/::\s*"?[A-Za-z_][\w$]*"?/g, '')
      .replace(/\s+/g, ' ')
  );
}

/** 이 마이그레이션이 정체성으로 쓰는 칸들. 권한 칸(`has*Access`)은 대상이 아니다. */
const IDENTITY_COLUMNS = ['memberKind', 'affiliationKind', 'affiliationName'];

/**
 * legacy `Role.ADMIN`에서 **정체성을 지어내는** 분기를 문법 모양과 무관하게 잡는다.
 *
 * 정규화한 문장에서 `SET "<정체성 칸>" = ...` 구만 떼어내고, 그 안의 모든
 * `WHEN ... THEN ...` 쌍을 훑는다. 조건에 `'ADMIN'`이 들어 있고 그 결과가
 * NULL이 아니면 위반이다 — simple CASE(`CASE "role" WHEN 'ADMIN' THEN x`)든
 * searched CASE(`CASE WHEN "role" = 'ADMIN' THEN x`)든 같은 사실을 뜻하므로
 * 둘 다 이 방식으로 걸린다.
 *
 * 결과가 `selectedMemberKind`·`selectedRole` 같은 「고른 값」으로 가는 것도 막는다.
 * 그것은 기록일 뿐 확정된 정체성이 아니므로 배정된 ADMIN이 읽어서는 안 된다.
 */
function findAdminIdentityInferences(migrationSql) {
  const normalized = normalizeSql(migrationSql);
  const failures = [];

  for (const column of IDENTITY_COLUMNS) {
    const assignment = new RegExp(`SET "${column}" =([^;]*)`, 'g');
    for (const [, expression] of normalized.matchAll(assignment)) {
      const branch =
        /WHEN\b(.*?)\bTHEN\b\s*(.*?)(?=\s*\bWHEN\b|\s*\bELSE\b|\s*\bEND\b)/gs;
      for (const [, condition, rawResult] of expression.matchAll(branch)) {
        if (!/'ADMIN'/.test(condition)) {
          continue;
        }
        const result = rawResult.trim().replace(/\s+/g, ' ');
        if (/^NULL$/i.test(result)) {
          continue;
        }
        failures.push(
          `bridge migration derives ${column} from legacy Role.ADMIN (\`${result}\`) — identity must stay unresolved`,
        );
      }
    }
  }
  return failures;
}

/** bridge 이후 schema.prisma가 반드시 만족해야 하는 모양. */
const REQUIRED_SCHEMA_PATTERNS = [
  // 정본 이름을 옛 물리 이름 위에 얹는다.
  [/model StaffAccessRequest \{/, 'canonical StaffAccessRequest model'],
  [/@@map\("RoleRequest"\)/, 'StaffAccessRequest @@map("RoleRequest")'],
  [
    /enum StaffAccessRequestStatus \{/,
    'canonical StaffAccessRequestStatus enum',
  ],
  [
    /@@map\("RoleRequestStatus"\)/,
    'StaffAccessRequestStatus @@map("RoleRequestStatus")',
  ],
  // 롤백에 필요한 legacy 잔존물.
  [/enum Role \{/, 'legacy Role enum retained for rollback'],
  [/\brole\s+Role\?/, 'legacy User.role retained for rollback'],
  [/selectedRole\s+Role\?/, 'legacy User.selectedRole retained for rollback'],
  [/^\s+name\s+String\?$/m, 'legacy User.name retained for rollback'],
  [/^\s+studentId\s+String\?$/m, 'legacy User.studentId retained for rollback'],
  [
    /^\s+department\s+String\?$/m,
    'legacy User.department retained for rollback',
  ],
  // 직전 이미지가 쓰지 않는 세 칸은 nullable로 남는다.
  [/memberKind\s+MemberKind\?/, 'nullable UserProfile.memberKind'],
  [
    /affiliationKind\s+AffiliationKind\?/,
    'nullable UserProfile.affiliationKind',
  ],
  [/affiliationName\s+String\?/, 'nullable UserProfile.affiliationName'],
  // 접근 권한은 fail-closed 기본값으로 잠긴다.
  [
    /hasStaffAccess\s+Boolean\s+@default\(false\)/,
    'fail-closed hasStaffAccess',
  ],
  [
    /hasAdminAccess\s+Boolean\s+@default\(false\)/,
    'fail-closed hasAdminAccess',
  ],
];

/**
 * 정본 코드가 legacy 사실을 **진실로 읽지 않는다**는 것을 잠근다.
 *
 * 스키마에 칸이 남아 있는 것과 그 칸을 읽는 것은 전혀 다른 일이다 — 남겨 둔 이유는
 * 오직 롤백이고, 읽는 순간 그것은 다시 정본이 된다.
 */
const FORBIDDEN_SOURCE_PATTERNS = [
  [/\bselectedRole\s*:\s*true\b/, 'a Prisma select of User.selectedRole'],
  [/\brole\s*:\s*true\b/, 'a Prisma select of User.role'],
  [/\bprisma\.roleRequest\b/, 'a Prisma call on the legacy roleRequest model'],
  [
    /\.roleRequest\.(?:find|create|update|delete|count)/,
    'a legacy roleRequest query',
  ],
  // raw SQL은 `@@map`을 통과하지 않으므로 물리 이름을 알아야 한다. 그 지식은
  // `roles/staff-access-request-physical-names.ts` 한 곳에만 둔다 — 흩어지면
  // 다음 contract PR의 개명이 한 군데를 빠뜨린다.
  [
    /FROM\s+"StaffAccessRequest"/,
    'a raw SQL reference to the canonical name (use the physical-name module)',
  ],
];

export function validateBridgeContract(schema, migrationSql, sourceFiles = []) {
  const failures = [];

  for (const [pattern, label] of FORBIDDEN_MIGRATION_PATTERNS) {
    if (pattern.test(stripComments(migrationSql))) {
      failures.push(`bridge migration contains ${label}`);
    }
  }
  for (const pattern of REQUIRED_MIGRATION_PATTERNS) {
    if (!pattern.test(migrationSql)) {
      failures.push(
        `bridge migration is missing required statement: ${pattern}`,
      );
    }
  }
  for (const [pattern, label] of REQUIRED_SCHEMA_PATTERNS) {
    if (!pattern.test(schema)) {
      failures.push(`schema is missing ${label}`);
    }
  }

  for (const [pattern, label] of FORBIDDEN_MIGRATION_INFERENCE_PATTERNS) {
    if (pattern.test(stripComments(migrationSql))) {
      failures.push(`bridge migration contains ${label}`);
    }
  }

  // 문법 모양과 무관하게 ADMIN→정체성 유도를 잡는다. 위의 정규식 목록과 달리
  // simple CASE·searched CASE·자격자 접두·캡스트를 모두 흡수한다.
  failures.push(...findAdminIdentityInferences(migrationSql));

  // 순서는 **접근 권한 두 칸**에서만 따진다. 다른 칸의 `SET NOT NULL`이 문서
  // 뒤쪽에 오는 것은 상관없으므로 전체에서 처음 만나는 토큰을 재지 않는다.
  const executable = stripComments(migrationSql);
  for (const column of ['hasStaffAccess', 'hasAdminAccess']) {
    const defaultAt = executable.search(
      new RegExp(`ALTER COLUMN "${column}" SET DEFAULT FALSE`),
    );
    const notNullAt = executable.search(
      new RegExp(`ALTER COLUMN "${column}" SET NOT NULL`),
    );
    if (defaultAt >= 0 && notNullAt >= 0 && defaultAt > notNullAt) {
      failures.push(
        `bridge migration locks ${column} NOT NULL before it sets DEFAULT FALSE`,
      );
    }
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

function stripComments(sql) {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

function main() {
  const [schemaPath, migrationPath, ...sourcePaths] = process.argv.slice(2);
  if (!schemaPath || !migrationPath) {
    process.stderr.write(
      'Usage: member-authority-bridge-contract.mjs <schema.prisma> <migration.sql> [source.ts...]\n',
    );
    process.exit(2);
  }
  const failures = validateBridgeContract(
    readFileSync(schemaPath, 'utf8'),
    readFileSync(migrationPath, 'utf8'),
    sourcePaths.map((path) => ({
      path,
      contents: readFileSync(path, 'utf8'),
    })),
  );
  if (failures.length > 0) {
    for (const failure of failures) {
      process.stderr.write(`bridge contract violation: ${failure}\n`);
    }
    process.exit(1);
  }
  process.stdout.write('{"status":"ok","scenario":"bridge-contract"}\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
