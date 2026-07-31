import { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import {
  ACCESS_AUDIT_ACTIONS,
  ACCESS_AUDIT_EVENT_KINDS,
} from '../audit-log/audit-log-metadata';
import { AuditLogRepository } from '../audit-log/audit-log.repository';
import { AuditLogService } from '../audit-log/audit-log.service';
import { DomainException } from '../common/error-code';
import { RolesErrorCode } from '../roles/roles-error-code.enum';
import { StaffRoleRequestsRepository } from '../roles/staff-role-requests.repository';
import { StaffRoleRequestsService } from '../roles/staff-role-requests.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAccessRepository } from './admin-access.repository';
import {
  PausedAdminAccessRepository,
  PausedStaffRoleRequestsRepository,
  RoleRequestRaceGate,
} from '../../test/admin-access-role-request-race.integration-support';
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
      where: { userId: { startsWith: 'test:pr03:admin-access-race:' } },
    }),
    prisma.user.updateMany({
      where: { id: { startsWith: 'test:pr03:admin-access-race:' } },
      data: { name: null, studentId: null, department: null },
    }),
  ]);
  await prisma.$disconnect();
});

it('returns the staff decision after the unified mutation waits for its commit', async () => {
  // Given
  const actor = await createUser(Role.ADMIN, 'actor');
  const target = await createUser(null, 'target');
  const profile = {
    name: '합성 경쟁 대상',
    studentId: `${8_200_000 + sequence}`,
    department: '소프트웨어공학과',
  };
  await prisma.user.update({
    where: { id: target.id },
    data: { ...profile, profile: { create: profile } },
  });
  const request = await prisma.roleRequest.create({
    data: { id: `${target.id}:request`, userId: target.id },
  });
  const gate = new RoleRequestRaceGate();
  const auditLog = new AuditLogService(new AuditLogRepository(prisma));
  const adminService = new AdminAccessService(
    new PausedAdminAccessRepository(new AdminAccessRepository(prisma), gate),
    auditLog,
  );
  const staffRequestService = new StaffRoleRequestsService(
    new PausedStaffRoleRequestsRepository(
      new StaffRoleRequestsRepository(prisma),
      gate,
    ),
    auditLog,
  );

  // When
  const staffDecision = staffRequestService.decide(actor.githubId, request.id, {
    action: 'REJECT',
    reason: '합성 legacy 반려 사유',
  });
  await gate.staffRequestTransitioned.wait();
  const unifiedDecision = adminService.patchAccess(actor.githubId, target.id, {
    expectedRole: null,
    desiredRole: Role.STAFF,
    expectedAccountStatus: AccountStatus.ACTIVE,
    desiredAccountStatus: AccountStatus.ACTIVE,
    expectedPendingRequest: {
      id: request.id,
      status: RoleRequestStatus.PENDING,
    },
    requestDecision: { decision: ADMIN_ACCESS_REQUEST_DECISIONS.APPROVE },
  });
  await gate.unifiedAdminLockRequested.wait();
  gate.allowStaffCommit.open();
  await expect(staffDecision).resolves.toMatchObject({
    status: RoleRequestStatus.REJECTED,
  });
  let staleError: unknown;
  try {
    await unifiedDecision;
    throw new Error('Unified access mutation unexpectedly succeeded');
  } catch (error: unknown) {
    staleError = error;
  }

  // Then
  if (!(staleError instanceof DomainException)) {
    throw staleError;
  }
  const [persistedUser, persistedRequest, auditLogs] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
    prisma.roleRequest.findUniqueOrThrow({ where: { id: request.id } }),
    prisma.auditLog.findMany({ where: { targetId: request.id } }),
  ]);
  expect(staleError.errorCode).toMatchObject({
    code: RolesErrorCode.ACCESS_STATE_MISMATCH,
    status: 409,
  });
  expect(persistedRequest).toMatchObject({
    status: RoleRequestStatus.REJECTED,
    rejectionReason: '합성 legacy 반려 사유',
    decidedById: actor.id,
  });
  expect(staleError.extensions.currentAccess).toEqual({
    id: persistedUser.id,
    role: persistedUser.role,
    accountStatus: persistedUser.accountStatus,
    pendingRequest:
      persistedRequest.status === RoleRequestStatus.PENDING
        ? {
            id: persistedRequest.id,
            status: RoleRequestStatus.PENDING,
            createdAt: persistedRequest.createdAt.toISOString(),
          }
        : null,
  });
  expect(persistedUser).toMatchObject({
    role: null,
    accountStatus: AccountStatus.ACTIVE,
  });
  expect(auditLogs).toHaveLength(1);
  expect(auditLogs[0]).toMatchObject({
    action: ACCESS_AUDIT_ACTIONS.ROLE_REQUEST_REJECTED,
  });
  expect(auditLogs[0]?.metadata).toMatchObject({
    eventKind: ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_REJECTED,
  });
});

async function createUser(role: Role | null, label: string) {
  sequence += 1;
  return prisma.user.create({
    data: {
      id: `test:pr03:admin-access-race:${label}:${sequence}`,
      githubId: 9_003_750_000n + BigInt(sequence),
      nickname: `synthetic-${label}-${sequence}`,
      role,
    },
    select: { id: true, githubId: true },
  });
}
