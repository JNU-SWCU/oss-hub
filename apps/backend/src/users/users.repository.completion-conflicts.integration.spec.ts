import { UserTransitionRepository } from './user-transition.repository';
import { AffiliationKind, MemberKind } from './user-contract.config';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { canonicalCompletion } from './member-authority-test-fixtures';
import {
  UsersRepository,
  type ProfileCompletionOutcome,
  type UsersRepositoryPort,
} from './users.repository';
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const userId = 'test:users:profile';
const githubId = 9600000000153001n;
const otherUserId = 'test:users:profile:other';
const firstProfile = {
  name: '합성 최초 사용자',
  studentId: '1'.repeat(6),
  department: '인공지능학부',
};
const secondProfile = {
  name: '합성 덮어쓰기 사용자',
  studentId: '2'.repeat(6),
  department: '소프트웨어공학과',
};
type PhoneAuditCallback = Parameters<
  UsersRepositoryPort['completeProfileIfUnchanged']
>[2];
const prisma = new PrismaService();
const repository = new UsersRepository(prisma, new UserTransitionRepository());
const recordPhoneAudit = jest
  .fn<Promise<void>, Parameters<PhoneAuditCallback>>()
  .mockResolvedValue(undefined);
async function completeCurrentProfile(
  profile: typeof firstProfile | typeof secondProfile,
): Promise<ProfileCompletionOutcome> {
  const current = await repository.findByGithubId(githubId);
  if (!current) {
    throw new Error('합성 프로필 사용자가 존재해야 합니다.');
  }
  return repository.completeProfileIfUnchanged(
    current,
    canonicalCompletion(profile),
    recordPhoneAudit,
  );
}
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
it('완료된 프로필은 두 번째 요청으로 덮어쓰지 않는다', async () => {
  const initial = await repository.findByGithubId(githubId);
  if (!initial) {
    throw new Error('합성 프로필 사용자가 존재해야 합니다.');
  }
  await repository.completeProfileIfUnchanged(
    initial,
    canonicalCompletion(firstProfile),
    recordPhoneAudit,
  );
  await expect(
    repository.completeProfileIfUnchanged(
      initial,
      canonicalCompletion(secondProfile),
      recordPhoneAudit,
    ),
  ).resolves.toBe('conflict');
  await expect(repository.findByGithubId(githubId)).resolves.toMatchObject({
    ...firstProfile,
    memberKind: MemberKind.STUDENT,
    affiliationKind: AffiliationKind.DEPARTMENT,
    affiliationName: firstProfile.department,
  });
});
it('프로필 행이 없는 미완료 계정도 완료 저장할 수 있다', async () => {
  await expect(completeCurrentProfile(secondProfile)).resolves.toBe(
    'completed',
  );
  await expect(repository.findByGithubId(githubId)).resolves.toMatchObject({
    ...secondProfile,
    memberKind: MemberKind.STUDENT,
    affiliationKind: AffiliationKind.DEPARTMENT,
    affiliationName: secondProfile.department,
  });
});
it('미완료 계정은 유효한 값으로 완료할 수 있다', async () => {
  await expect(completeCurrentProfile(firstProfile)).resolves.toBe('completed');
  await expect(repository.findByGithubId(githubId)).resolves.toMatchObject({
    ...firstProfile,
    memberKind: MemberKind.STUDENT,
    affiliationKind: AffiliationKind.DEPARTMENT,
    affiliationName: firstProfile.department,
  });
});
it('이미 생성된 User과 충돌하면 선점된 행은 바뀌지 않는다', async () => {
  const expected = await repository.findByGithubId(githubId);
  if (!expected) {
    throw new Error('합성 프로필 사용자가 존재해야 합니다.');
  }
  await prisma.user.update({
    where: { id: userId },
    data: {
      approvalStatus: 'NOT_REQUIRED',
      approvalRequestId: null,
      approvalRequestedAt: null,
      approvalDecidedAt: null,
      approvalDecidedById: null,
      approvalReason: null,
      name: '합성 선점 프로필',
      studentId: '153404',
      department: '인공지능학부',
      type: MemberKind.STUDENT,
      departmentType: AffiliationKind.DEPARTMENT,
      profileCreatedAt: new Date(),
      profileUpdatedAt: new Date(),
    },
  });
  const profileBefore = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      name: true,
      studentId: true,
      department: true,
      type: true,
      departmentType: true,
    },
  });
  const completed = repository.completeProfileIfUnchanged(
    expected,
    canonicalCompletion(firstProfile),
    recordPhoneAudit,
  );
  await expect(completed).resolves.toBe('conflict');
  await expect(
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        name: true,
        studentId: true,
        department: true,
        type: true,
        departmentType: true,
      },
    }),
  ).resolves.toEqual(profileBefore);
});
it('동일한 완료 요청이 경쟁하면 한 요청만 성공하고 다른 요청은 CAS miss로 수렴한다', async () => {
  const expected = await repository.findByGithubId(githubId);
  if (!expected) {
    throw new Error('합성 프로필 사용자가 존재해야 합니다.');
  }
  const complete = () =>
    repository.completeProfileIfUnchanged(
      expected,
      canonicalCompletion(firstProfile),
      recordPhoneAudit,
    );
  const results = await Promise.all([complete(), complete()]);
  expect(results.filter((outcome) => outcome === 'completed')).toHaveLength(1);
  expect(results.filter((outcome) => outcome === 'conflict')).toHaveLength(1);
  await expect(repository.findByGithubId(githubId)).resolves.toMatchObject({
    name: firstProfile.name,
    studentId: firstProfile.studentId,
    department: firstProfile.department,
    memberKind: MemberKind.STUDENT,
    affiliationKind: AffiliationKind.DEPARTMENT,
    affiliationName: firstProfile.department,
  });
});
