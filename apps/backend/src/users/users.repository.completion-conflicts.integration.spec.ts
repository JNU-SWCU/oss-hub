import { AffiliationKind, MemberKind } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { canonicalCompletion } from './member-authority-test-fixtures';
import { UsersRepository } from './users.repository';
import type { ProfileCompletionOutcome } from './users.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const userId = 'test:users:profile';
const githubId = 9_600_000_000_153_001n;
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

const prisma = new PrismaService();
const repository = new UsersRepository(prisma);

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
  );
}

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

it('완료된 프로필은 두 번째 요청으로 덮어쓰지 않는다', async () => {
  const initial = await repository.findByGithubId(githubId);
  if (!initial) {
    throw new Error('합성 프로필 사용자가 존재해야 합니다.');
  }
  await repository.completeProfileIfUnchanged(
    initial,
    canonicalCompletion(firstProfile),
  );

  await expect(
    repository.completeProfileIfUnchanged(
      initial,
      canonicalCompletion(secondProfile),
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

it('이미 생성된 UserProfile과 충돌하면 선점된 행은 바뀌지 않는다', async () => {
  // Given
  const expected = await repository.findByGithubId(githubId);
  if (!expected) {
    throw new Error('합성 프로필 사용자가 존재해야 합니다.');
  }
  await prisma.userProfile.create({
    data: {
      userId,
      name: '합성 선점 프로필',
      studentId: '153404',
      department: '인공지능학부',
      memberKind: MemberKind.STUDENT,
      affiliationKind: AffiliationKind.DEPARTMENT,
      affiliationName: '인공지능학부',
    },
  });
  const profileBefore = await prisma.userProfile.findUniqueOrThrow({
    where: { userId },
    select: {
      name: true,
      studentId: true,
      department: true,
      memberKind: true,
      affiliationKind: true,
      affiliationName: true,
    },
  });

  // When
  const completed = repository.completeProfileIfUnchanged(
    expected,
    canonicalCompletion(firstProfile),
  );

  // Then — 선점된 프로필은 한 글자도 바뀌지 않는다
  await expect(completed).resolves.toBe('conflict');
  await expect(
    prisma.userProfile.findUniqueOrThrow({
      where: { userId },
      select: {
        name: true,
        studentId: true,
        department: true,
        memberKind: true,
        affiliationKind: true,
        affiliationName: true,
      },
    }),
  ).resolves.toEqual(profileBefore);
});

it('동일한 완료 요청이 경쟁하면 한 요청만 성공하고 다른 요청은 CAS miss로 수렴한다', async () => {
  // Given — 같은 스냅샷을 두 요청이 함께 들고 들어간다
  const expected = await repository.findByGithubId(githubId);
  if (!expected) {
    throw new Error('합성 프로필 사용자가 존재해야 합니다.');
  }
  const complete = () =>
    repository.completeProfileIfUnchanged(
      expected,
      canonicalCompletion(firstProfile),
    );

  // When
  const results = await Promise.all([complete(), complete()]);

  // Then — 행 잠금이 둘을 직렬화하고, 진 쪽은 조용히 덮어쓰지 않는다
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
