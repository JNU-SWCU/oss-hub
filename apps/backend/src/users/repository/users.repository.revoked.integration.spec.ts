import {
  AffiliationKind,
  MemberKind,
  StaffAccessRequestStatus,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../../test/integration-database.guard';
import { AuditLogService } from '../../audit-log/service/audit-log.service';
import { AuditLogRepository } from '../../audit-log/repository/audit-log.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { canonicalCompletion } from '../service/member-authority-test-fixtures';
import { UsersRepository } from './users.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const userId = 'test:users:profile';
const githubId = 9_600_000_000_153_001n;
const otherUserId = 'test:users:profile:other';
const prisma = new PrismaService();
const repository = new UsersRepository(
  prisma,
  new AuditLogService(new AuditLogRepository(prisma)),
);

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await prisma.staffAccessRequest.deleteMany({
    where: { userId: { in: [userId, otherUserId] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [userId, otherUserId] } },
  });
  await prisma.user.create({
    data: {
      id: userId,
      githubId,
      nickname: 'synthetic-profile-user',
      selectedMemberKind: MemberKind.STUDENT,
      hasStaffAccess: false,
      hasAdminAccess: false,
    },
  });
});

afterAll(async () => {
  await prisma.staffAccessRequest.deleteMany({
    where: { userId: { in: [userId, otherUserId] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [userId, otherUserId] } },
  });
  await prisma.$disconnect();
});

describe('가입을 마치지 못한 채 회수된 사용자 (#184)', () => {
  const revokedUserId = 'test:users:revoked-incomplete';
  const revokedGithubId = 9_600_000_000_184_001n;
  const REVOKED_AT = new Date('2026-02-02T00:00:00.000Z');

  beforeEach(async () => {
    await prisma.staffAccessRequest.deleteMany({
      where: { userId: revokedUserId },
    });
    await prisma.user.deleteMany({ where: { id: revokedUserId } });
    await prisma.user.create({
      data: {
        id: revokedUserId,
        githubId: revokedGithubId,
        nickname: 'synthetic-184-revoked-incomplete',

        selectedMemberKind: MemberKind.STAFF,
        hasStaffAccess: false,
        hasAdminAccess: false,
      },
    });
    await prisma.staffAccessRequest.create({
      data: {
        userId: revokedUserId,
        status: StaffAccessRequestStatus.REVOKED,
        createdAt: REVOKED_AT,
        decidedAt: REVOKED_AT,
      },
    });
  });

  afterAll(async () => {
    await prisma.staffAccessRequest.deleteMany({
      where: { userId: revokedUserId },
    });
    await prisma.user.deleteMany({ where: { id: revokedUserId } });
  });

  it('프로필을 마치면 새 교직원 승인 요청이 만들어지고 권한은 그대로 없다', async () => {
    const current = await repository.findByGithubId(revokedGithubId);
    if (!current) {
      throw new Error('합성 회수 사용자가 존재해야 합니다.');
    }
    expect(current.hasStaffAccess).toBe(false);
    expect(current.hasAdminAccess).toBe(false);
    expect(current.selectedMemberKind).toBe(MemberKind.STAFF);
    expect(current.memberKind).toBeNull();

    const completed = await repository.completeProfileIfUnchanged(
      current,
      canonicalCompletion(
        {
          name: '합성 교직원',
          studentId: null,
          department: '인공지능학부',
        },
        MemberKind.STAFF,
        AffiliationKind.PROGRAM_OFFICE,
      ),
    );

    const [stored, profile, requests] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: revokedUserId } }),
      prisma.userProfile.findUniqueOrThrow({
        where: { userId: revokedUserId },
      }),
      prisma.staffAccessRequest.findMany({
        where: { userId: revokedUserId },
        orderBy: [{ createdAt: 'asc' }],
      }),
    ]);
    expect(completed).toBe('completed');
    expect(profile).toMatchObject({
      name: '합성 교직원',
      studentId: null,
      memberKind: MemberKind.STAFF,
      affiliationKind: AffiliationKind.PROGRAM_OFFICE,
      affiliationName: '인공지능학부',
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]?.status).toBe(StaffAccessRequestStatus.REVOKED);
    expect(requests[1]?.status).toBe(StaffAccessRequestStatus.PENDING);

    expect(stored.hasStaffAccess).toBe(false);
    expect(stored.hasAdminAccess).toBe(false);
  });

  it('학생을 고른 뒤 프로필을 마치면 교직원 신청은 만들어지지 않는다', async () => {
    await prisma.user.update({
      where: { id: revokedUserId },
      data: {
        selectedMemberKind: MemberKind.STUDENT,
        hasStaffAccess: false,
        hasAdminAccess: false,
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
    );

    const [stored, profile, pendingCount] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: revokedUserId } }),
      prisma.userProfile.findUniqueOrThrow({
        where: { userId: revokedUserId },
      }),
      prisma.staffAccessRequest.count({
        where: {
          userId: revokedUserId,
          status: StaffAccessRequestStatus.PENDING,
        },
      }),
    ]);
    expect(stored.hasStaffAccess).toBe(false);
    expect(stored.hasAdminAccess).toBe(false);
    expect(profile.memberKind).toBe(MemberKind.STUDENT);
    expect(pendingCount).toBe(0);
  });
});
