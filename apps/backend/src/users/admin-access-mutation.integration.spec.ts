import {
  userAuditRows,
  writeApprovalFixture,
  requestHistory,
} from './user-history.integration-fixture';

import { flatProfileFixture } from './canonical-user-fixture';
import { AdminRepository } from './admin.repository';
import { UserTransitionRepository } from './user-transition.repository';
import {
  DepartmentType,
  MemberKind,
  StaffAccessRequestStatus,
} from './user-contract.config';
import { AdminAccessReadOrderingRepository } from './admin-access-read-ordering.repository';
import { AdminAccessReadRepository } from './admin-access-read.repository';
import { AdminAccessHistoryRepository } from './admin-access-history.repository';
import { canonicalUserCreateFromLabel } from './canonical-user-fixture';
import { AccountStatus } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import {
  ACCESS_AUDIT_ACTIONS,
  ACCESS_AUDIT_EVENT_KINDS,
} from '../platform/audit-log-metadata.config';
import { UserHistoryRepository } from './user-history.repository';
import { PrismaService } from '../platform/prisma.service';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessService } from './admin-access.service';
import { ADMIN_ACCESS_REQUEST_DECISIONS } from './admin-access-query.config';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
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
const service = new AdminAccessService(
  repository,
  new UserHistoryRepository(new UserTransitionRepository()),
  new AdminAccessMutationService(
    new AuditLogMetadataService(),
    new UserProfileService(),
  ),
);
let sequence = 0;
beforeAll(async () => {
  await prisma.$connect();
});
afterAll(() => prisma.$disconnect());
describe('Admin access atomic request decisions', () => {
  it('approves the request, grants STAFF, and appends one immutable audit row', async () => {
    const actor = await createUser('ADMIN', 'approve-actor');
    const target = await createUser(null, 'approve-target');
    const profile = {
      name: '합성 승인 대상',
      studentId: `${9100000 + sequence}`,
      department: '소프트웨어공학과',
      memberKind: MemberKind.STUDENT,
      departmentType: DepartmentType.DEPARTMENT,
    };
    await prisma.user.update({
      where: { id: target.id },
      data: {
        approvalRequestId: null,
        approvalRequestedAt: null,
        approvalDecidedAt: null,
        approvalDecidedById: null,
        approvalReason: null,
        ...flatProfileFixture(profile),
        profileCreatedAt: new Date(),
        profileUpdatedAt: new Date(),
        type: MemberKind.STUDENT,
        approvalStatus: 'NOT_REQUIRED',
      },
    });
    const request = await writeApprovalFixture(prisma, {
      id: `${target.id}:request`,
      userId: target.id,
    });
    const result = await service.patchAccess(actor.githubId, target.id, {
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
    });
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
      prisma.user.findUniqueOrThrow({
        include: { admin: true },
        where: { id: target.id },
      }),
    ).resolves.toMatchObject({
      approvalStatus: 'APPROVED',
      admin: null,
      accountStatus: AccountStatus.ACTIVE,
    });
    await expect(
      requestHistory(prisma)
        .then((rows) => rows.filter((row) => row.id === request.id))
        .then((rows) => {
          const row = rows[0];
          if (!row) throw new TypeError('Expected request history fixture');
          return row;
        }),
    ).resolves.toMatchObject({
      status: StaffAccessRequestStatus.APPROVED,
      decidedById: actor.id,
      rejectionReason: null,
    });
    const logs = await userAuditRows(prisma, { targetId: request.id });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: ACCESS_AUDIT_ACTIONS.ROLE_REQUEST_APPROVED,
      targetType: 'ROLE_REQUEST',
    });
    expect(logs[0]?.metadata).toMatchObject({
      eventKind: ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_APPROVED,
    });
    await expect(
      prisma.userHistory.update({
        where: { id: logs[0]?.id ?? 'missing' },
        data: { event: 'PHONE_UPDATED' },
      }),
    ).rejects.toThrow();
  });
  it('rejects a pending request and leaves the current staff approval rejected', async () => {
    const actor = await createUser('STAFF', 'staff-reject-actor');
    const target = await createUser('STAFF', 'staff-reject-target');
    const request = await writeApprovalFixture(prisma, {
      id: `${target.id}:request`,
      userId: target.id,
    });
    const result = await service.patchAccess(actor.githubId, target.id, {
      expectedRole: null,
      desiredRole: null,
      expectedHasStaffAccess: false,
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
    expect(result).toMatchObject({
      role: null,
      decidedRequest: {
        id: request.id,
        status: StaffAccessRequestStatus.REJECTED,
      },
    });
    await expect(
      prisma.user.findUniqueOrThrow({
        include: { admin: true },
        where: { id: target.id },
      }),
    ).resolves.toMatchObject({
      approvalStatus: 'REJECTED',
      admin: null,
    });
  });
  it('rejects a pending request and deactivates the account while preserving role', async () => {
    const actor = await createUser('ADMIN', 'reject-actor');
    const target = await createUser(null, 'reject-target');
    const request = await writeApprovalFixture(prisma, {
      id: `${target.id}:request`,
      userId: target.id,
    });
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
    await expect(
      prisma.user.findUniqueOrThrow({
        include: { admin: true },
        where: { id: target.id },
      }),
    ).resolves.toMatchObject({
      approvalStatus: 'REJECTED',
      admin: null,
      accountStatus: AccountStatus.DEACTIVATED,
    });
    await expect(
      requestHistory(prisma)
        .then((rows) => rows.filter((row) => row.id === request.id))
        .then((rows) => {
          const row = rows[0];
          if (!row) throw new TypeError('Expected request history fixture');
          return row;
        }),
    ).resolves.toMatchObject({
      status: StaffAccessRequestStatus.REJECTED,
      rejectionReason: '합성 반려 사유',
      decidedById: actor.id,
    });
    await expect(
      userAuditRows(prisma, { targetId: request.id }).then(
        (rows) => rows.length,
      ),
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
      githubId: 9003600000n + BigInt(sequence),
      nickname: `synthetic-${label}-${sequence}`,
    }),
    select: { id: true, githubId: true },
  });
}
