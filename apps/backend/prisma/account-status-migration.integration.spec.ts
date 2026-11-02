import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inLegacyUserSchema } from './legacy-user-migration.fixture';
import { AdminAccessReadOrderingRepository } from '../src/users/admin-access-read-ordering.repository';
import { AdminAccessReadRepository } from '../src/users/admin-access-read.repository';
import { AdminAccessHistoryRepository } from '../src/users/admin-access-history.repository';
import { AccountStatus } from '@prisma/client';
import { StaffAccessRequestStatus } from '../src/users/user-contract.config';
import { AuthErrorCode } from '../src/auth/auth-error-code.error';
import { AuthConfig } from '../src/platform/auth.config';
import { AuthRepository } from '../src/auth/auth.repository';
import { AuthService } from '../src/auth/auth.service';
import { AdminRepository } from '../src/users/admin.repository';
import { UserTransitionRepository } from '../src/users/user-transition.repository';
import { UserHistoryRepository } from '../src/users/user-history.repository';
import type { ConsentsService } from '../src/users/consents.service';
import { PrismaService } from '../src/platform/prisma.service';
import { loadRuntimeConfig } from '../src/platform/runtime-config.config';
import { MemberOnboardingRepository } from '../src/users/member-onboarding.repository';
import { MemberOnboardingService } from '../src/users/member-onboarding.service';
import { AdminAccessRepository } from '../src/users/admin-access.repository';
import { AdminAccessService } from '../src/users/admin-access.service';
import { canonicalUserCreateFromLabel } from '../src/users/canonical-user-fixture';
import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import { AuditLogMetadataService } from '../src/platform/audit-log-metadata.service';
import { AdminAccessMutationService } from '../src/users/admin-access-mutation.service';
import { CollectionUserActivityService } from '../src/github/collection-user-activity.service';
import { CollectionUserActivityRepository } from '../src/github/repository-provision-job.repository';
import { CollectionDiscoveryClient } from '../src/github/collection-discovery.client';
import { CollectionPublicTokenService } from '../src/github/collection-public-token.service';
import { UserProfileService } from '../src/users/user-profile.service';
import { AuthSessionService } from '../src/platform/auth-session.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const ADMIN_ID = 'test:188:migration:admin';
const STAFF_ID = 'test:188:migration:staff';
const APPROVED_REQUEST_ID = 'test:188:migration:approved';
const REVOKED_REQUEST_ID = 'test:188:migration:revoked';
const ADMIN_GITHUB_ID = 9_188_100_001n;
const STAFF_GITHUB_ID = 9_188_100_002n;

describe('accountStatus migration regression', () => {
  const prisma = new PrismaService();
  const transitions = new UserTransitionRepository();
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
    new AuthRepository(prisma),
    new UserProfileService(),
    new AuthSessionService(),
    new CollectionUserActivityService(
      new CollectionUserActivityRepository(prisma),
      new CollectionDiscoveryClient(
        {},
        new CollectionPublicTokenService(loadRuntimeConfig({})),
      ),
    ),
  );

  const rolesService = new MemberOnboardingService(
    new MemberOnboardingRepository(prisma, transitions),
    {
      requireCurrent: jest.fn(),
    } satisfies Pick<ConsentsService, 'requireCurrent'>,
    new UserProfileService(),
  );
  const adminAccessService = new AdminAccessService(
    new AdminAccessRepository(
      prisma,
      new AdminAccessHistoryRepository(),
      new AdminAccessReadRepository(new AdminAccessReadOrderingRepository()),
      new AdminRepository(prisma),
      transitions,
    ),
    new UserHistoryRepository(transitions),
    new AdminAccessMutationService(
      new AuditLogMetadataService(),
      new UserProfileService(),
    ),
  );

  beforeAll(async () => {
    await prisma.$connect();
    const migrated = await inLegacyUserSchema(prisma, async (transaction) => {
      await transaction.$executeRaw`INSERT INTO "User" ("id") VALUES (${STAFF_ID})`;
      await transaction.$executeRaw`
        INSERT INTO "RoleRequest" ("id", "userId", "status", "createdAt") VALUES
        (${APPROVED_REQUEST_ID}, ${STAFF_ID}, 'APPROVED', '2026-07-20T09:00:00Z'),
        (${REVOKED_REQUEST_ID}, ${STAFF_ID}, 'REVOKED', '2026-07-21T09:00:00Z')
      `;
      const migration = readFileSync(
        join(
          process.cwd(),
          'prisma/migrations/20260721190000_add_user_account_status/migration.sql',
        ),
        'utf8',
      );
      for (const statement of migration
        .split(';')
        .filter((sql) => sql.trim())) {
        await transaction.$executeRawUnsafe(statement);
      }
      return transaction.$queryRaw<
        { readonly role: string; readonly accountStatus: AccountStatus }[]
      >`SELECT "role", "accountStatus" FROM "User" WHERE "id" = ${STAFF_ID}`;
    });
    expect(migrated).toEqual([
      { role: 'STAFF', accountStatus: AccountStatus.DEACTIVATED },
    ]);
    const legacyStaff = migrated[0];
    if (legacyStaff === undefined)
      throw new TypeError('Missing migrated staff fixture');
    await prisma.user.create({
      data: canonicalUserCreateFromLabel('ADMIN', {
        id: ADMIN_ID,
        githubId: ADMIN_GITHUB_ID,
        nickname: 'synthetic-migration-admin',
      }),
    });

    await prisma.user.create({
      data: {
        ...canonicalUserCreateFromLabel('STAFF', {
          id: STAFF_ID,
          githubId: STAFF_GITHUB_ID,
          nickname: 'synthetic-migration-staff',
          accountStatus: legacyStaff.accountStatus,
        }),
        approvalRequestId: REVOKED_REQUEST_ID,
        approvalRequestedAt: new Date('2026-07-21T09:00:00.000Z'),
      },
    });
    await prisma.userHistory.createMany({
      data: [
        {
          id: APPROVED_REQUEST_ID,
          status: StaffAccessRequestStatus.APPROVED,
          at: '2026-07-20T09:00:00.000Z',
        },
        {
          id: REVOKED_REQUEST_ID,
          status: StaffAccessRequestStatus.REVOKED,
          at: '2026-07-21T09:00:00.000Z',
        },
      ].map(({ id, status, at }) => ({
        id: `migration:request:${id}`,
        userId: STAFF_ID,
        actorId: ADMIN_ID,
        event: 'LEGACY_IMPORT',
        source: 'MIGRATION',
        sourceTable: 'StaffAccessRequest',
        sourceId: id,
        occurredAt: new Date(at),
        data: {
          schemaVersion: 1,
          recordKind: 'REQUEST_SNAPSHOT',
          requestId: id,
          original: {
            id,
            userId: STAFF_ID,
            status,
            decidedById: ADMIN_ID,
            decidedAt: at,
            createdAt: at,
            updatedAt: at,
            rejectionReason: null,
          },
        },
      })),
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('기존 최신 REVOKED 사용자를 이관하고 관리자 재활성화로만 복구한다', async () => {
    const migratedStaff = await prisma.user.findUniqueOrThrow({
      where: { id: STAFF_ID },
      include: { admin: true },
    });

    expect(migratedStaff).toMatchObject({
      type: 'STAFF',
      approvalStatus: 'APPROVED',
      admin: null,
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
      prisma.user.findUniqueOrThrow({
        where: { id: STAFF_ID },
        include: { admin: true },
      }),
      new AdminAccessHistoryRepository().listAdminAccessStaffAccessRequestHistory(
        prisma,
        STAFF_ID,
        { page: 1, limit: 20 },
      ),
    ]);
    expect(reactivatedStaff).toMatchObject({
      type: 'STAFF',
      approvalStatus: 'APPROVED',
      admin: null,
      accountStatus: AccountStatus.ACTIVE,
    });
    expect(reactivated).toMatchObject({
      role: 'STAFF',
      accountStatus: AccountStatus.ACTIVE,
      decidedRequest: null,
    });

    expect(requests.total).toBe(2);
    expect(requests.items).toEqual(
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
