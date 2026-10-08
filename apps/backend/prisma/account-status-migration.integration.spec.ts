import { AccountStatus, StaffAccessRequestStatus } from '@prisma/client';
import { AuthErrorCode } from '../src/auth/domain/auth-error-code.enum';
import { AuthConfig } from '../src/auth/auth.config';
import { AuthRepository } from '../src/auth/repository/auth.repository';
import { AuthService } from '../src/auth/service/auth.service';
import { AuditLogRepository } from '../src/audit-log/audit-log.repository';
import { AuditLogService } from '../src/audit-log/audit-log.service';
import type { ConsentsService } from '../src/consents/service/consents.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { loadRuntimeConfig } from '../src/runtime-config/runtime-config';
import { UsersOnboardingRepository } from '../src/users/repository/onboarding.repository';
import { RolesService } from '../src/roles/service/roles.service';
import { AdminAccessRepository } from '../src/users/admin-access.repository';
import { AdminAccessService } from '../src/users/admin-access.service';
import { canonicalUserCreateFromLabel } from '../src/users/canonical-user-fixture';
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

  const rolesService = new RolesService(new UsersOnboardingRepository(prisma), {
    requireCurrent: jest.fn(),
  } satisfies Pick<ConsentsService, 'requireCurrent'>);
  const adminAccessService = new AdminAccessService(
    new AdminAccessRepository(prisma),
    new AuditLogService(new AuditLogRepository(prisma)),
  );

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.deleteMany({
      where: { id: { in: [ADMIN_ID, STAFF_ID] } },
    });
    await prisma.user.create({
      data: canonicalUserCreateFromLabel('ADMIN', {
        id: ADMIN_ID,
        githubId: ADMIN_GITHUB_ID,
        nickname: 'synthetic-migration-admin',
      }),
    });

    await prisma.user.create({
      data: canonicalUserCreateFromLabel('STAFF', {
        id: STAFF_ID,
        githubId: STAFF_GITHUB_ID,
        nickname: 'synthetic-migration-staff',
        accountStatus: AccountStatus.DEACTIVATED,
      }),
    });
    await prisma.staffAccessRequest.createMany({
      data: [
        {
          id: APPROVED_REQUEST_ID,
          userId: STAFF_ID,
          status: StaffAccessRequestStatus.APPROVED,
          decidedById: ADMIN_ID,
          decidedAt: new Date('2026-07-20T09:00:00.000Z'),
          createdAt: new Date('2026-07-20T09:00:00.000Z'),
          updatedAt: new Date('2026-07-20T09:00:00.000Z'),
        },
        {
          id: REVOKED_REQUEST_ID,
          userId: STAFF_ID,
          status: StaffAccessRequestStatus.REVOKED,
          decidedById: ADMIN_ID,
          decidedAt: new Date('2026-07-21T09:00:00.000Z'),
          createdAt: new Date('2026-07-21T09:00:00.000Z'),
          updatedAt: new Date('2026-07-21T09:00:00.000Z'),
        },
      ],
    });
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('기존 최신 REVOKED 사용자를 이관하고 관리자 재활성화로만 복구한다', async () => {
    const migratedStaff = await prisma.user.findUniqueOrThrow({
      where: { id: STAFF_ID },
    });

    expect(migratedStaff).toMatchObject({
      hasStaffAccess: true,
      hasAdminAccess: false,
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
        expectedRole: 'STAFF',
        desiredRole: 'STAFF',
        expectedAccountStatus: AccountStatus.DEACTIVATED,
        desiredAccountStatus: AccountStatus.ACTIVE,
        expectedPendingRequest: null,
      },
    );

    const [reactivatedStaff, requests] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: STAFF_ID } }),
      prisma.staffAccessRequest.findMany({
        where: { userId: STAFF_ID },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);
    expect(reactivatedStaff).toMatchObject({
      hasStaffAccess: true,
      hasAdminAccess: false,
      accountStatus: AccountStatus.ACTIVE,
    });
    expect(reactivated).toMatchObject({
      role: 'STAFF',
      accountStatus: AccountStatus.ACTIVE,
      decidedRequest: null,
    });

    expect(requests).toHaveLength(2);
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: APPROVED_REQUEST_ID,
          status: StaffAccessRequestStatus.APPROVED,
        }),
        expect.objectContaining({
          id: REVOKED_REQUEST_ID,
          status: StaffAccessRequestStatus.REVOKED,
        }),
      ]),
    );
  });
});
