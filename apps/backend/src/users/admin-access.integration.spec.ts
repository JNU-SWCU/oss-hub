import { userAuditRows } from './user-history.integration-fixture';

import { AdminRepository } from './admin.repository';
import { UserTransitionRepository } from './user-transition.repository';
import { AdminAccessReadOrderingRepository } from './admin-access-read-ordering.repository';
import { AdminAccessReadRepository } from './admin-access-read.repository';
import { AdminAccessHistoryRepository } from './admin-access-history.repository';
import { canonicalUserCreateFromLabel } from './canonical-user-fixture';
import { AccountStatus } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { UserHistoryRepository } from './user-history.repository';
import { PrismaService } from '../platform/prisma.service';
import { RolesErrorCode } from './roles-error-code.error';
import { BarrierIndependentAuthorityRepository } from './admin-access.integration-support';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessService } from './admin-access.service';
import { IndependentAuthorityRepository } from './independent-authority.repository';
import { ADMIN_ACCESS_COMMANDS } from './admin-access-query.config';
import { IndependentAuthorityService } from './independent-authority.service';
import { HistoryMetadataService } from '../platform/history-metadata.service';
import { AdminAccessMutationService } from './admin-access-mutation.service';
import { UserProfileService } from './user-profile.service';
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const prisma = new PrismaService();
const repository = new AdminAccessRepository(
  prisma,
  new AdminAccessHistoryRepository(),
  new AdminAccessReadRepository(new AdminAccessReadOrderingRepository()),
  new AdminRepository(prisma),
  new UserTransitionRepository(),
);
const userHistory = new UserHistoryRepository(new UserTransitionRepository());
const service = new AdminAccessService(
  repository,
  userHistory,
  new AdminAccessMutationService(
    new HistoryMetadataService(),
    new UserProfileService(),
  ),
);
const AUDIT_FAILURE_FUNCTION = 'fail_admin_access_audit_insert';
const AUDIT_FAILURE_TRIGGER = 'fail_admin_access_audit_insert_trigger';
const AUDIT_FAILURE_MESSAGE = 'synthetic admin access audit failure';
let sequence = 0;
beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$executeRawUnsafe(
    `DROP TRIGGER IF EXISTS ${AUDIT_FAILURE_TRIGGER} ON "UserHistory"`,
  );
  await prisma.$executeRawUnsafe(
    `DROP FUNCTION IF EXISTS ${AUDIT_FAILURE_FUNCTION}()`,
  );
  await prisma.$disconnect();
});
describe('Admin access real PostgreSQL transactions', () => {
  it('serializes two mutual admin demotions so exactly one commits', async () => {
    await prisma.admin.deleteMany({
      where: { user: { accountStatus: 'ACTIVE' } },
    });
    const first = await createUser('ADMIN', 'race-a');
    const second = await createUser('ADMIN', 'race-b');
    const synchronizedService = new IndependentAuthorityService(
      new BarrierIndependentAuthorityRepository(
        new IndependentAuthorityRepository(
          prisma,
          new AdminAccessReadRepository(
            new AdminAccessReadOrderingRepository(),
          ),
          new AdminAccessRepository(
            prisma,
            new AdminAccessHistoryRepository(),
            new AdminAccessReadRepository(
              new AdminAccessReadOrderingRepository(),
            ),
            new AdminRepository(prisma),
            new UserTransitionRepository(),
          ),
          new AdminRepository(prisma),
        ),
      ),
      userHistory,
      new HistoryMetadataService(),
      new AdminAccessMutationService(
        new HistoryMetadataService(),
        new UserProfileService(),
      ),
      new UserProfileService(),
    );
    const demote = (actorGithubId: bigint, targetId: string) =>
      synchronizedService.patchAdminAccess(actorGithubId, targetId, {
        command: ADMIN_ACCESS_COMMANDS.REVOKE,
      });
    const results = await Promise.allSettled([
      demote(first.githubId, second.id),
      demote(second.githubId, first.id),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    const reason: unknown = rejected?.reason;
    expect(reason).toMatchObject({
      errorCode: {
        code: RolesErrorCode.ADMIN_ONLY,
        status: 403,
      },
    });
    await expect(
      prisma.user.count({
        where: { admin: { isNot: null }, accountStatus: AccountStatus.ACTIVE },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.adminHistory.count({
        where: { userId: { in: [first.id, second.id] }, event: 'REVOKED' },
      }),
    ).resolves.toBe(1);
  });
  it('rolls back the user CAS when PostgreSQL rejects the audit insert', async () => {
    const actor = await createUser('ADMIN', 'audit-actor');
    const target = await createUser('STUDENT', 'audit-target');
    await installAuditFailureTrigger();
    await expect(
      service.patchAccess(actor.githubId, target.id, {
        expectedRole: 'STUDENT',
        desiredRole: 'STUDENT',
        expectedAccountStatus: AccountStatus.ACTIVE,
        desiredAccountStatus: AccountStatus.DEACTIVATED,
        expectedPendingRequest: null,
      }),
    ).rejects.toThrow(AUDIT_FAILURE_MESSAGE);
    await expect(
      prisma.user.findUniqueOrThrow({
        include: { admin: true },
        where: { id: target.id },
      }),
    ).resolves.toMatchObject({
      approvalStatus: 'NOT_REQUIRED',
      admin: null,
      accountStatus: AccountStatus.ACTIVE,
    });
    await expect(
      userAuditRows(prisma, { targetId: target.id }).then(
        (rows) => rows.length,
      ),
    ).resolves.toBe(0);
  });
  it('returns the authoritative locked projection for a stale real-DB CAS', async () => {
    const actor = await createUser('ADMIN', 'stale-actor');
    const target = await createUser('STUDENT', 'stale-target');
    await prisma.user.update({
      where: { id: target.id },
      data: { type: 'STAFF', studentId: null, approvalStatus: 'APPROVED' },
    });
    const body = {
      expectedRole: 'STUDENT',
      desiredRole: 'ADMIN',
      expectedAccountStatus: AccountStatus.ACTIVE,
      desiredAccountStatus: AccountStatus.ACTIVE,
      expectedPendingRequest: null,
    } as const;
    const operation = service.patchAccess(actor.githubId, target.id, body);
    await expect(operation).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ACCESS_STATE_MISMATCH, status: 409 },
      extensions: {
        currentAccess: {
          id: target.id,
          role: 'STAFF',
          accountStatus: AccountStatus.ACTIVE,
          pendingRequest: null,
        },
      },
    });
    await expect(
      prisma.user.findUniqueOrThrow({
        include: { admin: true },
        where: { id: target.id },
      }),
    ).resolves.toMatchObject({
      approvalStatus: 'APPROVED',
      admin: null,
    });
  });
});
async function installAuditFailureTrigger(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION ${AUDIT_FAILURE_FUNCTION}()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION '${AUDIT_FAILURE_MESSAGE}';
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER ${AUDIT_FAILURE_TRIGGER}
    BEFORE INSERT ON "UserHistory"
    FOR EACH ROW
    EXECUTE FUNCTION ${AUDIT_FAILURE_FUNCTION}()
  `);
}
async function createUser(role: 'STUDENT' | 'STAFF' | 'ADMIN', label: string) {
  sequence += 1;
  return prisma.user.create({
    data: canonicalUserCreateFromLabel(role, {
      id: `test:pr03:admin-access:${label}:${sequence}`,
      githubId: 9003500000n + BigInt(sequence),
      nickname: `synthetic-${label}-${sequence}`,
    }),
    select: { id: true, githubId: true },
  });
}
