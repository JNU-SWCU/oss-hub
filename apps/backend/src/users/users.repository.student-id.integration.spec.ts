import { AffiliationKind, MemberKind } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { AuditLogService } from '../audit-log/service/audit-log.service';
import { AuditLogRepository } from '../audit-log/repository/audit-log.repository';
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
const otherGithubId = 9_600_000_000_153_002n;
const studentProfile = {
  name: '합성 학생',
  studentId: '9'.repeat(6),
  department: '인공지능학부',
};
type StoredProfileFields = {
  readonly name: string;
  readonly studentId: string | null;
  readonly department: string;
  readonly memberKind: MemberKind;
  readonly affiliationKind: AffiliationKind;
  readonly affiliationName: string;
};

const prisma = new PrismaService();
const repository = new UsersRepository(
  prisma,
  new AuditLogService(new AuditLogRepository(prisma)),
);

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
      hasStaffAccess: false,
      hasAdminAccess: false,
    },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { id: { in: [userId, otherUserId] } },
  });
  await prisma.$disconnect();
});

describe('학번 최초 저장의 유일성', () => {
  async function createOnboardingStudent(
    id: string,
    github: bigint,
    nickname: string,
  ): Promise<void> {
    await prisma.user.upsert({
      where: { id },
      update: {
        selectedMemberKind: MemberKind.STUDENT,
        hasStaffAccess: false,
        hasAdminAccess: false,
      },
      create: {
        id,
        githubId: github,
        nickname,
        selectedMemberKind: MemberKind.STUDENT,
        hasStaffAccess: false,
        hasAdminAccess: false,
      },
    });
  }

  async function currentProfile(github: bigint) {
    const current = await repository.findByGithubId(github);
    if (!current) {
      throw new Error('합성 프로필 사용자가 존재해야 합니다.');
    }
    return current;
  }

  it('학생의 첫 학번은 유일 제약이 걸린 UserProfile 행으로 저장된다', async () => {
    const current = await currentProfile(githubId);

    const outcome = await repository.completeProfileIfUnchanged(
      current,
      canonicalCompletion(studentProfile),
    );

    expect(outcome).toBe('completed');
    const profileRows = await prisma.$queryRaw<StoredProfileFields[]>`
      SELECT "name", "studentId", "department",
             "memberKind", "affiliationKind", "affiliationName"
      FROM "UserProfile"
      WHERE "userId" = ${userId}
    `;
    expect(profileRows).toEqual([
      {
        ...studentProfile,
        memberKind: MemberKind.STUDENT,
        affiliationKind: AffiliationKind.DEPARTMENT,
        affiliationName: studentProfile.department,
      },
    ]);
    await expect(repository.findByGithubId(githubId)).resolves.toMatchObject({
      studentId: studentProfile.studentId,
      memberKind: MemberKind.STUDENT,
    });
  });

  it('다른 계정이 이미 쓰는 학번은 두 번째 계정에 저장되지 않는다', async () => {
    await createOnboardingStudent(
      otherUserId,
      otherGithubId,
      'synthetic-profile-other',
    );
    const first = await currentProfile(githubId);
    await expect(
      repository.completeProfileIfUnchanged(
        first,
        canonicalCompletion(studentProfile),
      ),
    ).resolves.toBe('completed');

    const second = await currentProfile(otherGithubId);
    const outcome = await repository.completeProfileIfUnchanged(
      second,
      canonicalCompletion({
        ...studentProfile,
        name: '합성 둘째 학생',
      }),
    );

    expect(outcome).toBe('student-id-taken');
    await expect(
      prisma.userProfile.findUnique({ where: { userId: otherUserId } }),
    ).resolves.toBeNull();
    await expect(
      repository.findByGithubId(otherGithubId),
    ).resolves.toMatchObject({
      studentId: null,
      memberKind: null,
    });
  });

  it('같은 학번을 두 계정이 동시에 저장하면 한 건만 성공한다', async () => {
    await createOnboardingStudent(
      otherUserId,
      otherGithubId,
      'synthetic-profile-other',
    );
    const first = await currentProfile(githubId);
    const second = await currentProfile(otherGithubId);
    const complete = (current: typeof first, name: string) =>
      repository.completeProfileIfUnchanged(
        current,
        canonicalCompletion({ ...studentProfile, name }),
      );

    const outcomes = await Promise.all([
      complete(first, '합성 동시 첫째'),
      complete(second, '합성 동시 둘째'),
    ]);

    expect(outcomes.filter((outcome) => outcome === 'completed')).toHaveLength(
      1,
    );
    expect(
      outcomes.filter((outcome) => outcome === 'student-id-taken'),
    ).toHaveLength(1);
    const profileRows = await prisma.$queryRaw<{ studentId: string }[]>`
      SELECT "studentId" FROM "UserProfile"
      WHERE "studentId" = ${studentProfile.studentId}
    `;
    expect(profileRows).toEqual([{ studentId: studentProfile.studentId }]);
  });
});
