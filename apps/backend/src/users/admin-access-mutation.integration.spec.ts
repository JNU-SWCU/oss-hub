import { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import {
  ACCESS_AUDIT_ACTIONS,
  ACCESS_AUDIT_EVENT_KINDS,
} from '../audit-log/audit-log-metadata';
import { AuditLogStore } from '../audit-log/audit-log.store';
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
  new AuditLogService(new AuditLogStore(prisma)),
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
      data: { name: null, studentId: null, department: null },
    }),
  ]);
  await prisma.$disconnect();
});

describe('Admin access atomic request decisions', () => {
  it('approves the request, grants STAFF, and appends one immutable audit row', async () => {
    // Given
    const actor = await createUser(Role.ADMIN, 'approve-actor');
    const target = await createUser(null, 'approve-target');
    const profile = {
      name: '합성 승인 대상',
      studentId: `${8_000_000 + sequence}`,
      department: '소프트웨어공학과',
    };
    await prisma.user.update({
      where: { id: target.id },
      data: { ...profile, profile: { create: profile } },
    });
    const request = await prisma.roleRequest.create({
      data: { id: `${target.id}:request`, userId: target.id },
    });

    // When
    const result = await service.patchAccess(actor.githubId, target.id, {
      expectedRole: null,
      desiredRole: Role.STAFF,
      expectedAccountStatus: AccountStatus.ACTIVE,
      desiredAccountStatus: AccountStatus.ACTIVE,
      expectedPendingRequest: {
        id: request.id,
        status: RoleRequestStatus.PENDING,
      },
      requestDecision: {
        decision: ADMIN_ACCESS_REQUEST_DECISIONS.APPROVE,
      },
    });

    // Then
    expect(result).toMatchObject({
      role: Role.STAFF,
      accountStatus: AccountStatus.ACTIVE,
      pendingRequest: null,
      decidedRequest: { id: request.id, status: RoleRequestStatus.APPROVED },
    });
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
    ).resolves.toMatchObject({
      role: Role.STAFF,
      accountStatus: AccountStatus.ACTIVE,
    });
    await expect(
      prisma.roleRequest.findUniqueOrThrow({ where: { id: request.id } }),
    ).resolves.toMatchObject({
      status: RoleRequestStatus.APPROVED,
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

  it('rejects a pending request and deactivates the account while preserving role', async () => {
    // Given
    const actor = await createUser(Role.ADMIN, 'reject-actor');
    const target = await createUser(null, 'reject-target');
    const request = await prisma.roleRequest.create({
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
        status: RoleRequestStatus.PENDING,
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
      role: null,
      accountStatus: AccountStatus.DEACTIVATED,
    });
    await expect(
      prisma.roleRequest.findUniqueOrThrow({ where: { id: request.id } }),
    ).resolves.toMatchObject({
      status: RoleRequestStatus.REJECTED,
      rejectionReason: '합성 반려 사유',
      decidedById: actor.id,
    });
    await expect(
      prisma.auditLog.count({ where: { targetId: request.id } }),
    ).resolves.toBe(1);
  });
});

async function createUser(role: Role | null, label: string) {
  sequence += 1;
  return prisma.user.create({
    data: {
      id: `test:pr03:admin-access-mutation:${label}:${sequence}`,
      githubId: 9_003_600_000n + BigInt(sequence),
      nickname: `synthetic-${label}-${sequence}`,
      role,
    },
    select: { id: true, githubId: true },
  });
}
