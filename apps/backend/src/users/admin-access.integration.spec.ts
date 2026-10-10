import { canonicalUserCreateFromLabel } from './canonical-user-fixture';
import { AccountStatus } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { AuditLogRepository } from '../audit-log/repository/audit-log.repository';
import { AuditLogService } from '../audit-log/service/audit-log.service';
import type { AuthenticatedRequest } from '../auth/controller/http-auth';
import { PrismaService } from '../prisma/prisma.service';
import { RolesErrorCode } from './domain/roles-error-code.enum';
import { AdminAccessController } from './admin-access.controller';
import { BarrierIndependentAuthorityRepository } from './admin-access.integration-support';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessService } from './admin-access.service';
import { ADMIN_ACCESS_COMMANDS } from './domain/independent-authority';
import { PatchAdminAccessRequestDto } from './dto/patch-admin-access.dto';
import { IndependentAuthorityRepository } from './independent-authority.repository';
import { IndependentAuthorityService } from './independent-authority.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const repository = new AdminAccessRepository(prisma);
const auditLog = new AuditLogService(new AuditLogRepository(prisma));
const service = new AdminAccessService(repository, auditLog);
const AUDIT_FAILURE_FUNCTION = 'fail_admin_access_audit_insert';
const AUDIT_FAILURE_TRIGGER = 'fail_admin_access_audit_insert_trigger';
const AUDIT_FAILURE_MESSAGE = 'synthetic admin access audit failure';
let sequence = 0;

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(
    `DROP TRIGGER IF EXISTS ${AUDIT_FAILURE_TRIGGER} ON "AuditLog"`,
  );
  await prisma.$executeRawUnsafe(
    `DROP FUNCTION IF EXISTS ${AUDIT_FAILURE_FUNCTION}()`,
  );
  await prisma.$disconnect();
});

describe('Admin access real PostgreSQL transactions', () => {
  it('serializes two mutual admin demotions so exactly one commits', async () => {
    await prisma.user.updateMany({
      where: { hasAdminAccess: true, accountStatus: AccountStatus.ACTIVE },
      data: { hasAdminAccess: false, hasStaffAccess: true },
    });
    const first = await createUser('ADMIN', 'race-a');
    const second = await createUser('ADMIN', 'race-b');

    const synchronizedService = new IndependentAuthorityService(
      new BarrierIndependentAuthorityRepository(
        new IndependentAuthorityRepository(prisma),
      ),
      auditLog,
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

    const reason = rejected?.reason as
      { errorCode?: { code: string; status: number } } | undefined;
    expect(reason?.errorCode).toMatchObject({
      code: RolesErrorCode.ADMIN_ONLY,
      status: 403,
    });
    await expect(
      prisma.user.count({
        where: { hasAdminAccess: true, accountStatus: AccountStatus.ACTIVE },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.auditLog.count({
        where: { targetType: 'USER', targetId: { in: [first.id, second.id] } },
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
        desiredRole: 'STAFF',
        expectedAccountStatus: AccountStatus.ACTIVE,
        desiredAccountStatus: AccountStatus.ACTIVE,
        expectedPendingRequest: null,
      }),
    ).rejects.toThrow(AUDIT_FAILURE_MESSAGE);
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
    ).resolves.toMatchObject({
      hasStaffAccess: false,
      hasAdminAccess: false,
      accountStatus: AccountStatus.ACTIVE,
    });
    await expect(
      prisma.auditLog.count({ where: { targetId: target.id } }),
    ).resolves.toBe(0);
  });

  it('returns the authoritative locked projection for a stale real-DB CAS', async () => {
    const actor = await createUser('ADMIN', 'stale-actor');
    const target = await createUser('STUDENT', 'stale-target');
    await prisma.user.update({
      where: { id: target.id },
      data: { hasStaffAccess: true },
    });

    const profileService = {
      patchProfile: () => {
        throw new Error('patchProfile should not be called in this spec');
      },
    };
    const controller = new AdminAccessController(service, profileService);
    const request = {
      sessionGithubId: actor.githubId,
    } as Pick<AuthenticatedRequest, 'sessionGithubId'>;
    const body = Object.assign(new PatchAdminAccessRequestDto(), {
      expectedRole: 'STUDENT',
      desiredRole: 'ADMIN',
      expectedAccountStatus: AccountStatus.ACTIVE,
      desiredAccountStatus: AccountStatus.ACTIVE,
      expectedPendingRequest: null,
    });

    const operation = controller.patchAccess(request, target.id, body);

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
      prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
    ).resolves.toMatchObject({
      hasStaffAccess: true,
      hasAdminAccess: false,
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
    BEFORE INSERT ON "AuditLog"
    FOR EACH ROW
    EXECUTE FUNCTION ${AUDIT_FAILURE_FUNCTION}()
  `);
}

async function createUser(role: 'STUDENT' | 'STAFF' | 'ADMIN', label: string) {
  sequence += 1;
  return prisma.user.create({
    data: canonicalUserCreateFromLabel(role, {
      id: `test:pr03:admin-access:${label}:${sequence}`,
      githubId: 9_003_500_000n + BigInt(sequence),
      nickname: `synthetic-${label}-${sequence}`,
    }),
    select: { id: true, githubId: true },
  });
}
