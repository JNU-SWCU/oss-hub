import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
import { AuthErrorCode } from '../src/auth/auth-error-code.enum';
import { AuthConfig } from '../src/auth/auth.config';
import { AuthRepository } from '../src/auth/auth.repository';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RolesRepository } from '../src/roles/roles.repository';
import { RolesService } from '../src/roles/roles.service';
import { StaffRoleRequestsRepository } from '../src/roles/staff-role-requests.repository';
import { StaffRoleRequestsService } from '../src/roles/staff-role-requests.service';
import type { UsersService } from '../src/users/users.service';
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
  const authService = new AuthService(
    new AuthConfig(),
    new AuthRepository(prisma),
  );
  const rolesService = new RolesService(
    new RolesRepository(prisma),
    { requireCurrent: jest.fn() },
    {
      requireCompleteProfile: jest.fn(),
    } satisfies Pick<UsersService, 'requireCompleteProfile'>,
  );
  const staffRoleRequestsService = new StaffRoleRequestsService(
    new StaffRoleRequestsRepository(prisma),
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
    const reactivated = await staffRoleRequestsService.decide(
      ADMIN_GITHUB_ID,
      REVOKED_REQUEST_ID,
      { action: 'REACTIVATE' },
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
    expect(reactivated.status).toBe(RoleRequestStatus.APPROVED);
    expect(reactivated.id).not.toBe(APPROVED_REQUEST_ID);
    expect(requests).toHaveLength(3);
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: REVOKED_REQUEST_ID,
          status: RoleRequestStatus.REVOKED,
        }),
        expect.objectContaining({
          id: reactivated.id,
          status: RoleRequestStatus.APPROVED,
        }),
      ]),
    );
  });
});
