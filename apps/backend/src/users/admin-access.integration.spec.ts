import { AccountStatus, Role } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { AuditLogStore } from '../audit-log/audit-log.store';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { AuthenticatedRequest } from '../auth/session.guard';
import { PrismaService } from '../prisma/prisma.service';
import { RolesErrorCode } from '../roles/roles-error-code.enum';
import { AdminAccessController } from './admin-access.controller';
import { BarrierAdminAccessRepository } from './admin-access.integration-support';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessService } from './admin-access.service';
import { PatchAdminAccessRequestDto } from './dto/patch-admin-access.dto';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const repository = new AdminAccessRepository(prisma);
const auditLog = new AuditLogService(new AuditLogStore(prisma));
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
  it('serializes two final-admin demotions so exactly one commits', async () => {
    // Given
    await prisma.user.updateMany({
      where: { role: Role.ADMIN, accountStatus: AccountStatus.ACTIVE },
      data: { role: Role.STAFF },
    });
    const first = await createUser(Role.ADMIN, 'race-a');
    const second = await createUser(Role.ADMIN, 'race-b');
    const synchronizedService = new AdminAccessService(
      new BarrierAdminAccessRepository(repository),
      auditLog,
    );
    const demote = (targetId: string) =>
      synchronizedService.patchAccess(first.githubId, targetId, {
        expectedRole: Role.ADMIN,
        desiredRole: Role.STAFF,
        expectedAccountStatus: AccountStatus.ACTIVE,
        desiredAccountStatus: AccountStatus.ACTIVE,
        expectedPendingRequest: null,
      });

    // When
    const results = await Promise.allSettled([
      demote(first.id),
      demote(second.id),
    ]);

    // Then
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected?.reason).toMatchObject({
      errorCode: {
        code: RolesErrorCode.LAST_ACTIVE_ADMIN_REQUIRED,
        status: 409,
      },
    });
    await expect(
      prisma.user.count({
        where: { role: Role.ADMIN, accountStatus: AccountStatus.ACTIVE },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.auditLog.count({
        where: { targetType: 'USER', targetId: { in: [first.id, second.id] } },
      }),
    ).resolves.toBe(1);
  });

  it('rolls back the user CAS when PostgreSQL rejects the audit insert', async () => {
    // Given
    const actor = await createUser(Role.ADMIN, 'audit-actor');
    const target = await createUser(Role.STUDENT, 'audit-target');
    await installAuditFailureTrigger();

    // When / Then
    await expect(
      service.patchAccess(actor.githubId, target.id, {
        expectedRole: Role.STUDENT,
        desiredRole: Role.STAFF,
        expectedAccountStatus: AccountStatus.ACTIVE,
        desiredAccountStatus: AccountStatus.ACTIVE,
        expectedPendingRequest: null,
      }),
    ).rejects.toThrow(AUDIT_FAILURE_MESSAGE);
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
    ).resolves.toMatchObject({
      role: Role.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
    });
    await expect(
      prisma.auditLog.count({ where: { targetId: target.id } }),
    ).resolves.toBe(0);
  });

  it('returns the authoritative locked projection for a stale real-DB CAS', async () => {
    // Given
    const actor = await createUser(Role.ADMIN, 'stale-actor');
    const target = await createUser(Role.STUDENT, 'stale-target');
    await prisma.user.update({
      where: { id: target.id },
      data: { role: Role.STAFF },
    });
    const controller = new AdminAccessController(service);
    const request = {
      sessionGithubId: actor.githubId,
    } as Pick<AuthenticatedRequest, 'sessionGithubId'>;
    const body = Object.assign(new PatchAdminAccessRequestDto(), {
      expectedRole: Role.STUDENT,
      desiredRole: Role.ADMIN,
      expectedAccountStatus: AccountStatus.ACTIVE,
      desiredAccountStatus: AccountStatus.ACTIVE,
      expectedPendingRequest: null,
    });

    // When
    const operation = controller.patchAccess(request, target.id, body);

    // Then
    await expect(operation).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ACCESS_STATE_MISMATCH, status: 409 },
      extensions: {
        currentAccess: {
          id: target.id,
          role: Role.STAFF,
          accountStatus: AccountStatus.ACTIVE,
          pendingRequest: null,
        },
      },
    });
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
    ).resolves.toMatchObject({ role: Role.STAFF });
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

async function createUser(role: Role, label: string) {
  sequence += 1;
  return prisma.user.create({
    data: {
      id: `test:pr03:admin-access:${label}:${sequence}`,
      githubId: 9_003_500_000n + BigInt(sequence),
      nickname: `synthetic-${label}-${sequence}`,
      role,
    },
    select: { id: true, githubId: true },
  });
}
