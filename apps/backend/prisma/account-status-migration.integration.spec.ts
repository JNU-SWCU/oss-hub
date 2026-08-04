import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
import { AuthErrorCode } from '../src/auth/auth-error-code.enum';
import { AuthConfig } from '../src/auth/auth.config';
import { AuthRepository } from '../src/auth/auth.repository';
import { AuthService } from '../src/auth/auth.service';
import { AuditLogStore } from '../src/audit-log/audit-log.store';
import { AuditLogService } from '../src/audit-log/audit-log.service';
import type { ConsentsService } from '../src/consents/consents.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { loadRuntimeConfig } from '../src/runtime-config/runtime-config';
import { RolesRepository } from '../src/roles/roles.repository';
import { RolesService } from '../src/roles/roles.service';
import { AdminAccessRepository } from '../src/users/admin-access.repository';
import { AdminAccessService } from '../src/users/admin-access.service';
import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const ADMIN_ID = 'test:188:migration:admin';
const STAFF_ID = 'test:188:migration:staff';
const APPROVED_REQUEST_ID = 'test:188:migration:approved';
const REVOKED_REQUEST_ID = 'test:188:migration:revoked';
const ADMIN_GITHUB_ID = 9_188_100_001n;
const STAFF_GITHUB_ID = 9_188_100_002n;
const migrationSql = readFileSync(
  resolve(
    __dirname,
    'migrations/20260721190000_add_user_account_status/migration.sql',
  ),
  'utf8',
);
const migrationStatements = migrationSql
  .split(';')
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0);

describe('accountStatus migration regression', () => {
  const prisma = new PrismaService();
  const authConfig = new AuthConfig(
    loadRuntimeConfig({
      SESSION_SECRET: Buffer.from(
        'synthetic-account-status-migration-session-secret',
      ).toString('base64url'),
      FRONTEND_URL: 'http://localhost:3000',
      GITHUB_OAUTH_CLIENT_ID: 'synthetic-client-id',
      GITHUB_OAUTH_CLIENT_SECRET: 'synthetic-client-secret',
      GITHUB_OAUTH_CALLBACK_URL:
        'http://localhost:3000/api/v1/auth/github/callback',
    }),
  );
  const authService = new AuthService(
    authConfig,
    new AuthRepository(prisma, authConfig),
  );
  // 이 회귀 테스트가 보는 것은 마이그레이션 결과이지 온보딩 게이트가 아니다 —
  // `getMyRequest`는 동의 확인을 거치지 않으므로 이 mock은 한 번도 호출되지 않고,
  // 생성자를 채워 서비스를 세우는 역할만 한다. 그래서 `satisfies`로 실제 서비스
  // 시그니처와 모양이 어긋나면 컴파일에서 잡히게 묶어 둔다.
  //
  // 예전에 세 번째로 넘기던 `UsersService` mock은 지웠다. 역할 배정의 선행 조건에서
  // "완료된 프로필"이 빠지면서(RolesService 문서 주석 참고) `RolesService`가 더 이상
  // 그 협력자를 받지 않는다. 남겨 두면 그 mock이 지키던 계약이 사라졌는데도 있는 것처럼
  // 보일 뿐 아니라, 인자 수가 맞지 않아 typecheck가 TS2554로 죽는다.
  const rolesService = new RolesService(new RolesRepository(prisma), {
    requireCurrent: jest.fn(),
  } satisfies Pick<ConsentsService, 'requireCurrent'>);
  const adminAccessService = new AdminAccessService(
    new AdminAccessRepository(prisma),
    new AuditLogService(new AuditLogStore(prisma)),
  );

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.$executeRaw`ALTER TABLE "User" DROP COLUMN "accountStatus"`;
    await prisma.$executeRaw`DROP TYPE "AccountStatus"`;
    await prisma.$executeRaw`
      INSERT INTO "User" ("id", "githubId", "login", "role", "updatedAt")
      VALUES
        (${ADMIN_ID}, ${ADMIN_GITHUB_ID}, 'synthetic-migration-admin', 'ADMIN'::"Role", CURRENT_TIMESTAMP),
        (${STAFF_ID}, ${STAFF_GITHUB_ID}, 'synthetic-migration-staff', NULL, CURRENT_TIMESTAMP)
    `;
    await prisma.$executeRaw`
      INSERT INTO "RoleRequest" (
        "id", "userId", "status", "decidedById", "decidedAt", "createdAt", "updatedAt"
      )
      VALUES
        (
          ${APPROVED_REQUEST_ID}, ${STAFF_ID}, 'APPROVED'::"RoleRequestStatus", ${ADMIN_ID},
          '2026-07-20T09:00:00.000Z', '2026-07-20T09:00:00.000Z', '2026-07-20T09:00:00.000Z'
        ),
        (
          ${REVOKED_REQUEST_ID}, ${STAFF_ID}, 'REVOKED'::"RoleRequestStatus", ${ADMIN_ID},
          '2026-07-21T09:00:00.000Z', '2026-07-21T09:00:00.000Z', '2026-07-21T09:00:00.000Z'
        )
    `;
    for (const statement of migrationStatements) {
      await prisma.$executeRawUnsafe(statement);
    }
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('기존 최신 REVOKED 사용자를 이관하고 관리자 재활성화로만 복구한다', async () => {
    const migratedStaff = await prisma.user.findUniqueOrThrow({
      where: { id: STAFF_ID },
    });

    expect(migratedStaff).toMatchObject({
      role: Role.STAFF,
      accountStatus: AccountStatus.DEACTIVATED,
    });
    await expect(authService.getMe(STAFF_GITHUB_ID)).rejects.toMatchObject({
      errorCode: { code: AuthErrorCode.UNAUTHENTICATED },
    });
    await expect(
      rolesService.getMyRequest(STAFF_GITHUB_ID),
    ).rejects.toMatchObject({
      errorCode: { code: AuthErrorCode.UNAUTHENTICATED },
    });
    const reactivated = await adminAccessService.patchAccess(
      ADMIN_GITHUB_ID,
      STAFF_ID,
      {
        expectedRole: Role.STAFF,
        desiredRole: Role.STAFF,
        expectedAccountStatus: AccountStatus.DEACTIVATED,
        desiredAccountStatus: AccountStatus.ACTIVE,
        expectedPendingRequest: null,
      },
    );

    const [reactivatedStaff, requests] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: STAFF_ID } }),
      prisma.roleRequest.findMany({
        where: { userId: STAFF_ID },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);
    expect(reactivatedStaff).toMatchObject({
      role: Role.STAFF,
      accountStatus: AccountStatus.ACTIVE,
    });
    expect(reactivated).toMatchObject({
      role: Role.STAFF,
      accountStatus: AccountStatus.ACTIVE,
      decidedRequest: null,
    });
    // 통합 접근(AdminAccess) 경로는 대기 중 요청이 없는 계정 상태 전환에
    // 새 RoleRequest 이력 행을 만들지 않는다 — 마이그레이션이 이관한 두 행만
    // (APPROVED, REVOKED) 그대로 남아야 한다.
    expect(requests).toHaveLength(2);
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: APPROVED_REQUEST_ID,
          status: RoleRequestStatus.APPROVED,
        }),
        expect.objectContaining({
          id: REVOKED_REQUEST_ID,
          status: RoleRequestStatus.REVOKED,
        }),
      ]),
    );
  });
});
