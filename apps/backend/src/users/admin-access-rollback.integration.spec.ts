import { canonicalUserCreateFromLabel } from './canonical-user-fixture';
import {
  AccountStatus,
  AffiliationKind,
  MemberKind,
  StaffAccessRequestStatus,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { AuditLogRepository } from '../audit-log/audit-log.repository';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { RolesErrorCode } from '../roles/roles-error-code.enum';
import { FailingDecisionAdminAccessRepository } from './admin-access.integration-support';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessService } from './admin-access.service';
import { ADMIN_ACCESS_REQUEST_DECISIONS } from './domain/admin-access';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
let sequence = 0;

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$transaction([
    prisma.userProfile.deleteMany({
      where: { userId: { startsWith: 'test:pr03:admin-access-rollback:' } },
    }),
    prisma.user.updateMany({
      where: { id: { startsWith: 'test:pr03:admin-access-rollback:' } },
      data: { hasAdminAccess: false, hasStaffAccess: false },
    }),
  ]);
  await prisma.$disconnect();
});

it('rolls back the user CAS when the pending-request CAS fails second', async () => {
  // Given
  const actor = await createUser('ADMIN', 'actor');
  const target = await createUser(null, 'target');
  const profile = {
    name: '합성 롤백 대상',
    studentId: `${810_000 + sequence}`,
    department: '소프트웨어공학과',
    memberKind: MemberKind.STUDENT,
    affiliationKind: AffiliationKind.DEPARTMENT,
    affiliationName: '소프트웨어공학과',
  };
  await prisma.user.update({
    where: { id: target.id },
    data: { profile: { create: profile } },
  });
  const request = await prisma.staffAccessRequest.create({
    data: { id: `${target.id}:request`, userId: target.id },
  });
  const realRepository = new AdminAccessRepository(prisma);
  const service = new AdminAccessService(
    new FailingDecisionAdminAccessRepository(realRepository),
    new AuditLogService(new AuditLogRepository(prisma)),
  );

  // When / Then
  await expect(
    service.patchAccess(actor.githubId, target.id, {
      expectedRole: null,
      desiredRole: 'STAFF',
      expectedAccountStatus: AccountStatus.ACTIVE,
      desiredAccountStatus: AccountStatus.ACTIVE,
      expectedPendingRequest: {
        id: request.id,
        status: StaffAccessRequestStatus.PENDING,
      },
      requestDecision: {
        decision: ADMIN_ACCESS_REQUEST_DECISIONS.APPROVE,
      },
    }),
  ).rejects.toMatchObject({
    errorCode: { code: RolesErrorCode.ACCESS_STATE_MISMATCH, status: 409 },
  });
  await expect(
    prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
  ).resolves.toMatchObject({
    hasStaffAccess: false,
    hasAdminAccess: false,
    accountStatus: AccountStatus.ACTIVE,
  });
  await expect(
    prisma.staffAccessRequest.findUniqueOrThrow({ where: { id: request.id } }),
  ).resolves.toMatchObject({
    status: StaffAccessRequestStatus.PENDING,
    decidedById: null,
  });
  await expect(
    prisma.auditLog.count({ where: { targetId: request.id } }),
  ).resolves.toBe(0);
});

async function createUser(
  role: 'STUDENT' | 'STAFF' | 'ADMIN' | null,
  label: string,
) {
  sequence += 1;
  return prisma.user.create({
    data: canonicalUserCreateFromLabel(role, {
      id: `test:pr03:admin-access-rollback:${label}:${sequence}`,
      githubId: 9_003_700_000n + BigInt(sequence),
      nickname: `synthetic-${label}-${sequence}`,
    }),
    select: { id: true, githubId: true },
  });
}
