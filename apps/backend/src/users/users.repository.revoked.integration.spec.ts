import { MemberKind, StaffAccessRequestStatus } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { canonicalCompletion } from './member-authority-test-fixtures';
import { UsersRepository } from './users.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const userId = 'test:users:profile';
const githubId = 9_600_000_000_153_001n;
const otherUserId = 'test:users:profile:other';
const prisma = new PrismaService();
const repository = new UsersRepository(prisma);

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await prisma.user.deleteMany({
    where: { id: { in: [userId, otherUserId] } },
  });
  await prisma.user.create({
    data: {
      id: userId,
      githubId,
      nickname: 'synthetic-profile-user',
      selectedMemberKind: MemberKind.STUDENT,
    },
  });
});

afterAll(async () => {
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
    await prisma.staffAccessRequest.deleteMany({ where: { userId: revokedUserId } });
    await prisma.user.deleteMany({ where: { id: revokedUserId } });
    await prisma.user.create({
      data: {
        id: revokedUserId,
        githubId: revokedGithubId,
        nickname: 'synthetic-184-revoked-incomplete',
        // 학과가 비어 있어 교직원 기준으로도 미완료다.
        selectedMemberKind: null,
        hasStaffAccess: true,
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
    await prisma.staffAccessRequest.deleteMany({ where: { userId: revokedUserId } });
    await prisma.user.deleteMany({ where: { id: revokedUserId } });
  });

  it('프로필을 마치면 새 교직원 승인 요청이 만들어지고 권한은 그대로 없다', async () => {
    // Given
    const current = await repository.findByGithubId(revokedGithubId);
    if (!current) {
      throw new Error('합성 회수 사용자가 존재해야 합니다.');
    }
    expect(current.role).toBeNull();
    expect(current.selectedRole).toBe('STAFF');

    // When: 미완료 → 완료 저장. 이것이 `가입 마치기`다.
    const completed = await repository.completeProfileIfUnchanged(
      current,
      canonicalCompletion(
        {
          name: '합성 교직원',
          studentId: null,
          department: '인공지능학부',
        },
        MemberKind.STAFF,
      ),
    );

    // Then
    const [stored, requests] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: revokedUserId } }),
      prisma.staffAccessRequest.findMany({
        where: { userId: revokedUserId },
        orderBy: [{ createdAt: 'asc' }],
      }),
    ]);
    expect(completed).toBe('completed');
    // 회수 이력은 남고 그 위에 새 신청이 얹힌다 — 덮어쓰지 않는다.
    expect(requests).toHaveLength(2);
    expect(requests[0]?.status).toBe(StaffAccessRequestStatus.REVOKED);
    expect(requests[1]?.status).toBe(StaffAccessRequestStatus.PENDING);
    // 승인은 여전히 관리자 손에 있다.
    expect(stored.role).toBeNull();
  });

  it('학생을 고른 뒤 프로필을 마치면 교직원 신청은 만들어지지 않는다', async () => {
    // Given: 회수 화면이 역할 선택으로 보냈고 그가 학생을 골랐다.
    await prisma.user.update({
      where: { id: revokedUserId },
      data: {
        selectedMemberKind: MemberKind.STUDENT,
      },
    });
    const current = await repository.findByGithubId(revokedGithubId);
    if (!current) {
      throw new Error('합성 회수 사용자가 존재해야 합니다.');
    }

    // When
    await repository.completeProfileIfUnchanged(
      current,
      canonicalCompletion({
        name: '합성 학생',
        studentId: '184001',
        department: '인공지능학부',
      }),
    );

    // Then: 고른 역할이 학생이면 확정도 학생이다 — 신청이 생기지 않는다.
    const [stored, pendingCount] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: revokedUserId } }),
      prisma.staffAccessRequest.count({
        where: { userId: revokedUserId, status: StaffAccessRequestStatus.PENDING },
      }),
    ]);
    expect(stored.role).toBe('STUDENT');
    expect(pendingCount).toBe(0);
  });
});
