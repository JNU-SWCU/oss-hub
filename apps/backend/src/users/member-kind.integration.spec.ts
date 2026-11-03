import { Prisma } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { PrismaSerializationRetryRepository } from '../platform/prisma-serialization-retry.repository';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { AdminRepository } from './admin.repository';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessReadRepository } from './admin-access-read.repository';
import { AdminAccessReadOrderingRepository } from './admin-access-read-ordering.repository';
import { AdminAccessHistoryRepository } from './admin-access-history.repository';
import { AdminAccessMutationService } from './admin-access-mutation.service';
import { MemberKindRepository } from './member-kind.repository';
import { MemberKindService } from './member-kind.service';
import { MemberKindProfileService } from './member-kind-profile.service';
import { UserProfileService } from './user-profile.service';
import { UserTransitionRepository } from './user-transition.repository';
import { UserHistoryRepository } from './user-history.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const prisma = new PrismaService();
const transitions = new UserTransitionRepository();
const profiles = new UserProfileService();
const access = new AdminAccessRepository(
  prisma,
  new AdminAccessHistoryRepository(),
  new AdminAccessReadRepository(new AdminAccessReadOrderingRepository()),
  new AdminRepository(prisma),
  transitions,
);
const repository = new MemberKindRepository(
  prisma,
  access,
  new PrismaSerializationRetryRepository(),
  transitions,
);
const audit = new UserHistoryRepository(transitions);
const service = new MemberKindService(
  repository,
  audit,
  new AuditLogMetadataService(),
  profiles,
  new AdminAccessMutationService(new AuditLogMetadataService(), profiles),
  new MemberKindProfileService(profiles),
);
let sequence = 0;
const at = new Date('2026-01-01T00:00:00.000Z');
beforeAll(() => prisma.$connect());
afterAll(() => prisma.$disconnect());

async function create(
  data: Omit<Prisma.UserCreateInput, 'id' | 'githubId' | 'nickname'> = {},
) {
  sequence++;
  return prisma.user.create({
    data: {
      id: 'test:member-kind:new:' + sequence,
      githubId: 9700700000n + BigInt(sequence),
      nickname: 'synthetic-' + sequence,
      type: 'STUDENT',
      name: 'Name',
      studentId: String(968600 + sequence),
      department: 'Department',
      departmentType: 'DEPARTMENT',
      profileCreatedAt: at,
      profileUpdatedAt: at,
      ...data,
    },
    include: { admin: true },
  });
}
async function actor() {
  return create({ admin: { create: { origin: 'BOOTSTRAP' } } });
}
function expectState(user: {
  type: 'UNSELECTED' | 'STUDENT' | 'STAFF';
  approvalStatus:
    'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED';
  approvalRequestId: string | null;
}) {
  if (user.type === 'UNSELECTED')
    throw new TypeError('This test requires a selected type');
  return {
    expectedMemberKind: user.type,
    expectedHasStaffAccess:
      user.type === 'STAFF' && user.approvalStatus === 'APPROVED',
    expectedApprovalStatus: user.approvalStatus,
    expectedApprovalRequestId: user.approvalRequestId,
  };
}

describe('new User identity and approval persistence', () => {
  it('allows self STAFF approval, closes matched pending request, and keeps independent Admin', async () => {
    const user = await create({
      type: 'STAFF',
      approvalStatus: 'PENDING',
      approvalRequestId: 'self-pending',
      approvalRequestedAt: at,
      admin: { create: { origin: 'BOOTSTRAP' } },
    });
    const result = await service.patchMemberKind(user.githubId, user.id, {
      memberKind: 'STAFF',
      ...expectState(user),
    });
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { admin: true },
    });
    expect(stored).toMatchObject({
      id: user.id,
      type: 'STAFF',
      approvalStatus: 'APPROVED',
      approvalDecidedById: user.id,
      studentId: user.studentId,
      profileUpdatedAt: at,
      admin: { userId: user.id },
    });
    expect(result.approvalRequestId).not.toBe('self-pending');
    const events = await prisma.userHistory.findMany({
      where: { userId: user.id },
      orderBy: { event: 'asc' },
    });
    expect(events.map((event) => event.event)).toEqual([
      'APPROVED',
      'REQUEST_SUPERSEDED',
      'TYPE_CHANGED',
    ]);
    expect(
      events.find((event) => event.event === 'REQUEST_SUPERSEDED')?.data,
    ).toMatchObject({
      cause: 'SUPERSEDED',
      replacementRequestId: result.approvalRequestId,
      request: {
        id: 'self-pending',
        status: 'REVOKED',
        createdAt: at.toISOString(),
      },
    });
  });
  it('rejects a stale replaced request without changing current state or writing history', async () => {
    const admin = await actor();
    const user = await create({
      type: 'STAFF',
      approvalStatus: 'PENDING',
      approvalRequestId: 'new-request',
      approvalRequestedAt: at,
    });
    await expect(
      service.patchMemberKind(admin.githubId, user.id, {
        memberKind: 'STAFF',
        ...expectState(user),
        expectedApprovalRequestId: 'old-request',
      }),
    ).rejects.toMatchObject({ errorCode: { code: 'ROL_013', status: 409 } });
    expect(await prisma.userHistory.count({ where: { userId: user.id } })).toBe(
      0,
    );
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).toMatchObject({
      approvalStatus: 'PENDING',
      approvalRequestId: 'new-request',
    });
  });
  it('permits one of two concurrent decisions and rolls the stale transaction back', async () => {
    const admin = await actor();
    const user = await create({
      type: 'STAFF',
      approvalStatus: 'PENDING',
      approvalRequestId: 'race-request',
      approvalRequestedAt: at,
    });
    const command = { memberKind: 'STAFF' as const, ...expectState(user) };
    const results = await Promise.allSettled([
      service.patchMemberKind(admin.githubId, user.id, command),
      service.patchMemberKind(admin.githubId, user.id, command),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(await prisma.userHistory.count({ where: { userId: user.id } })).toBe(
      3,
    );
  });
  it('round-trips STUDENT to approved STAFF to STUDENT, preserving identity, legacy studentId and Admin', async () => {
    const admin = await actor();
    const user = await create({
      studentId: '9686001234',
      admin: { create: { origin: 'BOOTSTRAP' } },
    });
    await service.patchMemberKind(admin.githubId, user.id, {
      memberKind: 'STAFF',
      ...expectState(user),
      staffNumber: ' staff-A7 ',
    });
    const staff = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(staff).toMatchObject({
      studentId: '9686001234',
      staffNumber: 'staff-A7',
      approvalStatus: 'APPROVED',
    });
    await service.patchMemberKind(admin.githubId, user.id, {
      memberKind: 'STUDENT',
      ...expectState(staff),
      department: ' New department ',
    });
    const student = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { admin: true },
    });
    expect(student).toMatchObject({
      type: 'STUDENT',
      studentId: '9686001234',
      department: 'New department',
      departmentType: 'DEPARTMENT',
      approvalStatus: 'NOT_REQUIRED',
      approvalRequestId: null,
      approvalDecidedAt: null,
      admin: { userId: user.id },
    });
    const history =
      await new AdminAccessHistoryRepository().listAdminAccessStaffAccessRequestHistory(
        prisma,
        user.id,
        { page: 1, limit: 20 },
      );
    expect(history.total).toBe(1);
    expect(history.items[0]).toMatchObject({
      id: staff.approvalRequestId,
      status: 'REVOKED',
    });
  });
  it('clears staffNumber while retaining the same approved request', async () => {
    const admin = await actor();
    const user = await create({
      type: 'STAFF',
      approvalStatus: 'APPROVED',
      approvalRequestId: 'approved-number',
      approvalRequestedAt: at,
      staffNumber: 'staff-A7',
    });
    await service.patchMemberKind(admin.githubId, user.id, {
      memberKind: 'STAFF',
      ...expectState(user),
      staffNumber: null,
    });
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).toMatchObject({
      staffNumber: null,
      approvalRequestId: 'approved-number',
      approvalStatus: 'APPROVED',
    });
    expect(
      await prisma.userHistory.count({
        where: { userId: user.id, event: 'PROFILE_UPDATED' },
      }),
    ).toBe(1);
    expect(
      await prisma.userHistory.count({
        where: { userId: user.id, event: 'APPROVED' },
      }),
    ).toBe(0);
  });
  it.each([
    ['replacement', '654321', 'SYS_003'],
    ['invalid', 'bad-id', 'SYS_003'],
  ] as const)(
    'rejects %s studentId without writes',
    async (_label, studentId, code) => {
      const admin = await actor();
      const user = await create({ type: 'STAFF', approvalStatus: 'APPROVED' });
      await expect(
        service.patchMemberKind(admin.githubId, user.id, {
          memberKind: 'STUDENT',
          ...expectState(user),
          studentId,
          department: 'Department',
        }),
      ).rejects.toMatchObject({ errorCode: { code } });
      expect(
        await prisma.userHistory.count({ where: { userId: user.id } }),
      ).toBe(0);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
          .studentId,
      ).toBe(user.studentId);
    },
  );
  it('rejects missing stored studentId and missing department', async () => {
    const admin = await actor();
    const user = await create({
      type: 'STAFF',
      approvalStatus: 'APPROVED',
      studentId: null,
    });
    await expect(
      service.patchMemberKind(admin.githubId, user.id, {
        memberKind: 'STUDENT',
        ...expectState(user),
        department: 'Department',
      }),
    ).rejects.toMatchObject({ errorCode: { code: 'USR_002' } });
    await expect(
      service.patchMemberKind(admin.githubId, user.id, {
        memberKind: 'STUDENT',
        ...expectState(user),
        studentId: '968999',
      }),
    ).rejects.toMatchObject({ errorCode: { code: 'USR_005' } });
  });
  it('maps duplicate studentId to a domain conflict and rolls back identity and histories', async () => {
    const admin = await actor();
    const owner = await create();
    const user = await create({
      type: 'STAFF',
      approvalStatus: 'APPROVED',
      studentId: null,
    });
    if (owner.studentId === null)
      throw new TypeError('Missing fixture student ID');
    await expect(
      service.patchMemberKind(admin.githubId, user.id, {
        memberKind: 'STUDENT',
        ...expectState(user),
        studentId: owner.studentId,
        department: 'Department',
      }),
    ).rejects.toMatchObject({ errorCode: { code: 'USR_008' } });
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).toMatchObject({ type: 'STAFF', studentId: null });
    expect(await prisma.userHistory.count({ where: { userId: user.id } })).toBe(
      0,
    );
  });
  it('rolls back profile, approval and request supersession when history writing fails', async () => {
    const admin = await actor();
    const user = await create({
      type: 'STAFF',
      approvalStatus: 'PENDING',
      approvalRequestId: 'fail-request',
      approvalRequestedAt: at,
    });
    const failing = new MemberKindService(
      repository,
      {
        record: jest
          .fn()
          .mockRejectedValue(new Error('synthetic history failure')),
      },
      new AuditLogMetadataService(),
      profiles,
      new AdminAccessMutationService(new AuditLogMetadataService(), profiles),
      new MemberKindProfileService(profiles),
    );
    await expect(
      failing.patchMemberKind(admin.githubId, user.id, {
        memberKind: 'STAFF',
        ...expectState(user),
        staffNumber: 'new',
      }),
    ).rejects.toThrow('synthetic history failure');
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).toMatchObject({
      approvalStatus: 'PENDING',
      approvalRequestId: 'fail-request',
      staffNumber: null,
    });
    expect(await prisma.userHistory.count({ where: { userId: user.id } })).toBe(
      0,
    );
  });
  it('rejects absent and incomplete profiles and safely rejects legacy pending supersession', async () => {
    const admin = await actor();
    const absent = await create({
      name: null,
      studentId: null,
      department: null,
      departmentType: null,
      profileCreatedAt: null,
      profileUpdatedAt: null,
    });
    await expect(
      service.patchMemberKind(admin.githubId, absent.id, {
        memberKind: 'STAFF',
        ...expectState(absent),
      }),
    ).rejects.toMatchObject({ errorCode: { code: 'USR_002' } });
    const pending = await create({
      type: 'STAFF',
      approvalStatus: 'PENDING',
      approvalRequestId: 'legacy-pending',
      approvalRequestedAt: at,
    });
    await expect(
      service.patchMemberKind(admin.githubId, pending.id, {
        memberKind: 'STAFF',
        expectedMemberKind: 'STAFF',
        expectedHasStaffAccess: false,
      }),
    ).rejects.toMatchObject({ errorCode: { code: 'ROL_013' } });
  });
});
