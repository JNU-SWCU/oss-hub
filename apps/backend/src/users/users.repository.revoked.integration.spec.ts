import {
  writeApprovalFixture,
  requestHistory,
} from './user-history.integration-fixture';

import { UserTransitionRepository } from './user-transition.repository';
import {
  DepartmentType,
  MemberKind,
  StaffAccessRequestStatus,
} from './user-contract.config';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { canonicalCompletion } from './member-authority-test-fixtures';
import { UsersRepository, type UsersRepositoryPort } from './users.repository';
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const userId = 'test:users:profile';
const githubId = 9600000000153001n;
const otherUserId = 'test:users:profile:other';
type PhoneAuditCallback = Parameters<
  UsersRepositoryPort['completeProfileIfUnchanged']
>[2];
const prisma = new PrismaService();
const repository = new UsersRepository(prisma, new UserTransitionRepository());
const recordPhoneAudit = jest
  .fn<Promise<void>, Parameters<PhoneAuditCallback>>()
  .mockResolvedValue(undefined);
beforeAll(async () => {
  await prisma.$connect();
});
beforeEach(async () => {
  await prisma.user.updateMany({
    where: { id: { in: [userId, otherUserId] } },
    data: {
      name: null,
      studentId: null,
      staffNumber: null,
      department: null,
      departmentType: null,
      profileCreatedAt: null,
      profileUpdatedAt: null,
      phone: null,
      type: 'UNSELECTED',
      approvalStatus: 'NOT_REQUIRED',
      approvalRequestId: null,
      approvalRequestedAt: null,
      approvalDecidedAt: null,
      approvalDecidedById: null,
      approvalReason: null,
    },
  });
  await prisma.user.upsert({
    where: { id: userId },
    create: {
      approvalRequestId: null,
      approvalRequestedAt: null,
      approvalDecidedAt: null,
      approvalDecidedById: null,
      approvalReason: null,
      id: userId,
      githubId,
      nickname: 'synthetic-profile-user',
      type: MemberKind.STUDENT,
      approvalStatus: 'NOT_REQUIRED',
    },
    update: {
      approvalRequestId: null,
      approvalRequestedAt: null,
      approvalDecidedAt: null,
      approvalDecidedById: null,
      approvalReason: null,
      id: userId,
      githubId,
      nickname: 'synthetic-profile-user',
      type: MemberKind.STUDENT,
      approvalStatus: 'NOT_REQUIRED',
    },
  });
});
afterAll(async () => {
  await prisma.user.updateMany({
    where: { id: { in: [userId, otherUserId] } },
    data: {
      name: null,
      studentId: null,
      staffNumber: null,
      department: null,
      departmentType: null,
      profileCreatedAt: null,
      profileUpdatedAt: null,
      phone: null,
      type: 'UNSELECTED',
      approvalStatus: 'NOT_REQUIRED',
      approvalRequestId: null,
      approvalRequestedAt: null,
      approvalDecidedAt: null,
      approvalDecidedById: null,
      approvalReason: null,
    },
  });
  await prisma.$disconnect();
});
describe('가입을 마치지 못한 채 회수된 사용자 (#184)', () => {
  let revokedUserId = 'test:users:revoked-incomplete';
  let revokedSequence = 0;
  let revokedGithubId = 9600000000184001n;
  const REVOKED_AT = new Date('2026-02-02T00:00:00.000Z');
  beforeEach(async () => {
    revokedSequence += 1;
    revokedUserId = `test:users:revoked-incomplete:${revokedSequence}`;
    revokedGithubId = 9600000000184000n + BigInt(revokedSequence);
    await prisma.user.updateMany({
      where: { id: revokedUserId },
      data: {
        name: null,
        studentId: null,
        staffNumber: null,
        department: null,
        departmentType: null,
        profileCreatedAt: null,
        profileUpdatedAt: null,
        phone: null,
        type: 'UNSELECTED',
        approvalStatus: 'NOT_REQUIRED',
        approvalRequestId: null,
        approvalRequestedAt: null,
        approvalDecidedAt: null,
        approvalDecidedById: null,
        approvalReason: null,
      },
    });
    await prisma.user.upsert({
      where: { id: revokedUserId },
      create: {
        id: revokedUserId,
        githubId: revokedGithubId,
        nickname: 'synthetic-184-revoked-incomplete',
        type: MemberKind.STAFF,
        approvalStatus: 'PENDING',
      },
      update: {
        id: revokedUserId,
        githubId: revokedGithubId,
        nickname: 'synthetic-184-revoked-incomplete',
        type: MemberKind.STAFF,
        approvalStatus: 'PENDING',
      },
    });
    await writeApprovalFixture(prisma, {
      userId: revokedUserId,
      status: StaffAccessRequestStatus.REVOKED,
      createdAt: REVOKED_AT,
      decidedAt: REVOKED_AT,
    });
  });
  afterAll(async () => {
    await prisma.user.updateMany({
      where: { id: revokedUserId },
      data: {
        name: null,
        studentId: null,
        staffNumber: null,
        department: null,
        departmentType: null,
        profileCreatedAt: null,
        profileUpdatedAt: null,
        phone: null,
        type: 'UNSELECTED',
        approvalStatus: 'NOT_REQUIRED',
        approvalRequestId: null,
        approvalRequestedAt: null,
        approvalDecidedAt: null,
        approvalDecidedById: null,
        approvalReason: null,
      },
    });
  });
  it('프로필을 마치면 새 교직원 승인 요청이 만들어지고 권한은 그대로 없다', async () => {
    const current = await repository.findByGithubId(revokedGithubId);
    if (!current) {
      throw new Error('합성 회수 사용자가 존재해야 합니다.');
    }
    expect(current.approvalStatus).toBe('REVOKED');
    expect(current.hasAdminAccess).toBe(false);
    expect(current.selectedMemberKind).toBe(MemberKind.STAFF);
    expect(current.memberKind).toBe(MemberKind.STAFF);
    const completed = await repository.completeProfileIfUnchanged(
      current,
      canonicalCompletion(
        {
          name: '합성 교직원',
          studentId: null,
          department: '인공지능학부',
        },
        MemberKind.STAFF,
        DepartmentType.PROGRAM_OFFICE,
      ),
      recordPhoneAudit,
    );
    const [stored, profile, requests] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        include: { admin: true },
        where: { id: revokedUserId },
      }),
      prisma.user.findUniqueOrThrow({
        include: { admin: true },
        where: { id: revokedUserId },
      }),
      requestHistory(prisma, revokedUserId),
    ]);
    expect(completed).toBe('completed');
    expect(profile).toMatchObject({
      name: '합성 교직원',
      studentId: null,
      type: MemberKind.STAFF,
      departmentType: DepartmentType.PROGRAM_OFFICE,
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]?.status).toBe(StaffAccessRequestStatus.REVOKED);
    expect(requests[1]?.status).toBe(StaffAccessRequestStatus.PENDING);
    expect(
      stored.type === 'STAFF' &&
        stored.approvalStatus === 'APPROVED' &&
        stored.profileCreatedAt !== null,
    ).toBe(false);
    expect(stored.admin !== null).toBe(false);
  });
  it('학생을 고른 뒤 프로필을 마치면 교직원 신청은 만들어지지 않는다', async () => {
    await prisma.user.update({
      where: { id: revokedUserId },
      data: {
        approvalRequestId: null,
        approvalRequestedAt: null,
        approvalDecidedAt: null,
        approvalDecidedById: null,
        approvalReason: null,
        type: MemberKind.STUDENT,
        approvalStatus: 'NOT_REQUIRED',
      },
    });
    const current = await repository.findByGithubId(revokedGithubId);
    if (!current) {
      throw new Error('합성 회수 사용자가 존재해야 합니다.');
    }
    await repository.completeProfileIfUnchanged(
      current,
      canonicalCompletion({
        name: '합성 학생',
        studentId: '184001',
        department: '인공지능학부',
      }),
      recordPhoneAudit,
    );
    const [stored, profile, pendingCount] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        include: { admin: true },
        where: { id: revokedUserId },
      }),
      prisma.user.findUniqueOrThrow({
        include: { admin: true },
        where: { id: revokedUserId },
      }),
      requestHistory(prisma, revokedUserId)
        .then((rows) =>
          rows.filter((row) => row.status === StaffAccessRequestStatus.PENDING),
        )
        .then((rows) => rows.length),
    ]);
    expect(
      stored.type === 'STAFF' &&
        stored.approvalStatus === 'APPROVED' &&
        stored.profileCreatedAt !== null,
    ).toBe(false);
    expect(stored.admin !== null).toBe(false);
    expect(profile.type).toBe(MemberKind.STUDENT);
    expect(pendingCount).toBe(0);
  });
});
