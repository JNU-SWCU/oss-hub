import { canonicalUserCreateFromLabel } from './canonical-user-fixture';
import {
  AccountStatus,
  AffiliationKind,
  MemberKind,
  StaffAccessRequestStatus,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import {
  ACCESS_AUDIT_ACTIONS,
  ACCESS_AUDIT_EVENT_KINDS,
} from '../audit-log/audit-log-metadata';
import { AuditLogRepository } from '../audit-log/audit-log.repository';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessService } from './admin-access.service';
import { ADMIN_ACCESS_REQUEST_DECISIONS } from './domain/admin-access';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const repository = new AdminAccessRepository(prisma);
const service = new AdminAccessService(
  repository,
  new AuditLogService(new AuditLogRepository(prisma)),
);
let sequence = 0;

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$transaction([
    prisma.userProfile.deleteMany({
      where: { userId: { startsWith: 'test:pr03:admin-access-mutation:' } },
    }),
    prisma.user.updateMany({
      where: { id: { startsWith: 'test:pr03:admin-access-mutation:' } },
      data: { hasAdminAccess: false, hasStaffAccess: false },
    }),
  ]);
  await prisma.$disconnect();
});

describe('Admin access atomic request decisions', () => {
  it('approves the request, grants STAFF, and appends one immutable audit row', async () => {
    // Given
    const actor = await createUser('ADMIN', 'approve-actor');
    const target = await createUser(null, 'approve-target');
    const profile = {
      name: '합성 승인 대상',
      studentId: `${9_100_000 + sequence}`,
      department: '소프트웨어공학과',
      memberKind: MemberKind.STUDENT,
      affiliationKind: AffiliationKind.DEPARTMENT,
      affiliationName: '소프트웨어공학과',
    };
    await prisma.user.update({
      where: { id: target.id },
      data: {
        selectedMemberKind: MemberKind.STUDENT,
        profile: { create: profile },
      },
    });
    const request = await prisma.staffAccessRequest.create({
      data: { id: `${target.id}:request`, userId: target.id },
    });

    // When
    const result = await service.patchAccess(actor.githubId, target.id, {
      expectedRole: 'STUDENT',
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
    });

    // Then
    expect(result).toMatchObject({
      role: 'STAFF',
      accountStatus: AccountStatus.ACTIVE,
      pendingRequest: null,
      decidedRequest: {
        id: request.id,
        status: StaffAccessRequestStatus.APPROVED,
      },
    });
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
    ).resolves.toMatchObject({
      hasStaffAccess: true,
      hasAdminAccess: false,
      accountStatus: AccountStatus.ACTIVE,
    });
    await expect(
      prisma.staffAccessRequest.findUniqueOrThrow({
        where: { id: request.id },
      }),
    ).resolves.toMatchObject({
      status: StaffAccessRequestStatus.APPROVED,
      decidedById: actor.id,
      rejectionReason: null,
    });
    const logs = await prisma.auditLog.findMany({
      where: { targetId: request.id },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: ACCESS_AUDIT_ACTIONS.ROLE_REQUEST_APPROVED,
      targetType: 'ROLE_REQUEST',
    });
    expect(logs[0]?.metadata).toMatchObject({
      eventKind: ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_APPROVED,
    });
    await expect(
      prisma.auditLog.update({
        where: { id: logs[0]?.id ?? 'missing' },
        data: { action: 'SYNTHETIC_MUTATION' },
      }),
    ).rejects.toThrow();
  });

  it('rejects a pending request without revoking independently granted staff access', async () => {
    // Given — 두 STAFF 권한은 canonical로 같지만, 대상 권한은 이 대기 요청과
    // 독립적으로 관리자가 이미 부여한 사실이다.
    const actor = await createUser('STAFF', 'staff-reject-actor');
    const target = await createUser('STAFF', 'staff-reject-target');
    const request = await prisma.staffAccessRequest.create({
      data: { id: `${target.id}:request`, userId: target.id },
    });

    // When
    const result = await service.patchAccess(actor.githubId, target.id, {
      expectedRole: 'STAFF',
      desiredRole: 'STAFF',
      expectedHasStaffAccess: true,
      expectedHasAdminAccess: false,
      expectedAccountStatus: AccountStatus.ACTIVE,
      desiredAccountStatus: AccountStatus.ACTIVE,
      expectedPendingRequest: {
        id: request.id,
        status: StaffAccessRequestStatus.PENDING,
      },
      requestDecision: {
        decision: ADMIN_ACCESS_REQUEST_DECISIONS.REJECT,
        reason: '합성 반려 사유',
      },
    });

    // Then
    expect(result).toMatchObject({
      role: 'STAFF',
      decidedRequest: {
        id: request.id,
        status: StaffAccessRequestStatus.REJECTED,
      },
    });
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
    ).resolves.toMatchObject({
      hasStaffAccess: true,
      hasAdminAccess: false,
    });
  });

  it('rejects a pending request and deactivates the account while preserving role', async () => {
    // Given
    const actor = await createUser('ADMIN', 'reject-actor');
    const target = await createUser(null, 'reject-target');
    const request = await prisma.staffAccessRequest.create({
      data: { id: `${target.id}:request`, userId: target.id },
    });

    // When
    await service.patchAccess(actor.githubId, target.id, {
      expectedRole: null,
      desiredRole: null,
      expectedAccountStatus: AccountStatus.ACTIVE,
      desiredAccountStatus: AccountStatus.DEACTIVATED,
      expectedPendingRequest: {
        id: request.id,
        status: StaffAccessRequestStatus.PENDING,
      },
      requestDecision: {
        decision: ADMIN_ACCESS_REQUEST_DECISIONS.REJECT,
        reason: '합성 반려 사유',
      },
    });

    // Then
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
    ).resolves.toMatchObject({
      hasStaffAccess: false,
      hasAdminAccess: false,
      accountStatus: AccountStatus.DEACTIVATED,
    });
    await expect(
      prisma.staffAccessRequest.findUniqueOrThrow({
        where: { id: request.id },
      }),
    ).resolves.toMatchObject({
      status: StaffAccessRequestStatus.REJECTED,
      rejectionReason: '합성 반려 사유',
      decidedById: actor.id,
    });
    await expect(
      prisma.auditLog.count({ where: { targetId: request.id } }),
    ).resolves.toBe(1);
  });
});

async function createUser(
  role: 'STUDENT' | 'STAFF' | 'ADMIN' | null,
  label: string,
) {
  sequence += 1;
  return prisma.user.create({
    data: canonicalUserCreateFromLabel(role, {
      id: `test:pr03:admin-access-mutation:${label}:${sequence}`,
      githubId: 9_003_600_000n + BigInt(sequence),
      nickname: `synthetic-${label}-${sequence}`,
    }),
    select: { id: true, githubId: true },
  });
}
