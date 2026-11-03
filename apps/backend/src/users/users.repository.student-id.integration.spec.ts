import { UserTransitionRepository } from './user-transition.repository';
import { DepartmentType, MemberKind } from './user-contract.config';
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
const otherGithubId = 9600000000153002n;
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
  readonly departmentType: DepartmentType;
};
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
describe('학번 최초 저장의 유일성', () => {
  async function createOnboardingStudent(
    id: string,
    github: bigint,
    nickname: string,
  ): Promise<void> {
    await prisma.user.upsert({
      where: { id },
      update: {
        approvalRequestId: null,
        approvalRequestedAt: null,
        approvalDecidedAt: null,
        approvalDecidedById: null,
        approvalReason: null,
        type: MemberKind.STUDENT,
        approvalStatus: 'NOT_REQUIRED',
      },
      create: {
        approvalRequestId: null,
        approvalRequestedAt: null,
        approvalDecidedAt: null,
        approvalDecidedById: null,
        approvalReason: null,
        id,
        githubId: github,
        nickname,
        type: MemberKind.STUDENT,
        approvalStatus: 'NOT_REQUIRED',
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
  it('학생의 첫 학번은 유일 제약이 걸린 User 행으로 저장된다', async () => {
    const current = await currentProfile(githubId);
    const outcome = await repository.completeProfileIfUnchanged(
      current,
      canonicalCompletion(studentProfile),
      recordPhoneAudit,
    );
    expect(outcome).toBe('completed');
    const profileRows = await prisma.$queryRaw<StoredProfileFields[]>`
      SELECT "name", "studentId", "department",
             "type" AS "memberKind", "departmentType" AS "departmentType", "department" AS "department"
      FROM "User"
      WHERE "id" = ${userId} AND "profileCreatedAt" IS NOT NULL
    `;
    expect(profileRows).toEqual([
      {
        ...studentProfile,
        memberKind: MemberKind.STUDENT,
        departmentType: DepartmentType.DEPARTMENT,
        department: studentProfile.department,
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
        recordPhoneAudit,
      ),
    ).resolves.toBe('completed');
    const second = await currentProfile(otherGithubId);
    const outcome = await repository.completeProfileIfUnchanged(
      second,
      canonicalCompletion({
        ...studentProfile,
        name: '합성 둘째 학생',
      }),
      recordPhoneAudit,
    );
    expect(outcome).toBe('student-id-taken');
    await expect(
      prisma.user.findUnique({
        include: { admin: true },
        where: { id: otherUserId },
      }),
    ).resolves.toMatchObject({ profileCreatedAt: null });
    await expect(
      repository.findByGithubId(otherGithubId),
    ).resolves.toMatchObject({
      studentId: null,
      memberKind: MemberKind.STUDENT,
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
        recordPhoneAudit,
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
    const profileRows = await prisma.$queryRaw<
      {
        studentId: string;
      }[]
    >`
      SELECT "studentId" FROM "User"
      WHERE "studentId" = ${studentProfile.studentId}
    `;
    expect(profileRows).toEqual([{ studentId: studentProfile.studentId }]);
  });
});
