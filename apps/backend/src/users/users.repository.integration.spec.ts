import { MemberKind, Role } from '@prisma/client';
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
type StoredProfileFields = {
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
};

const prisma = new PrismaService();
const repository = new UsersRepository(prisma);

async function completeCurrentProfile(
  profile: typeof firstProfile,
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
      name: 'GitHub 합성 이름',
      selectedRole: Role.STUDENT,
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

it('학번·학과를 DB에 저장하고 다시 조회한다', async () => {
  await expect(completeCurrentProfile(firstProfile)).resolves.toBe('completed');

  await expect(repository.findByGithubId(githubId)).resolves.toEqual({
    id: userId,
    role: Role.STUDENT,
    selectedRole: Role.STUDENT,
    selectedMemberKind: MemberKind.STUDENT,
    memberKind: MemberKind.STUDENT,
    affiliationKind: 'DEPARTMENT',
    affiliationName: firstProfile.department,
    hasStaffAccess: false,
    hasAdminAccess: false,
    hasPendingStaffRequest: false,
    ...firstProfile,
  });
});

it('학번 없는 교직원 프로필은 UserProfile 행 없이 legacy 컬럼에만 저장한다', async () => {
  // Given — UserProfile.studentId가 NOT NULL이라 행을 만들 수 없다(#439)
  await prisma.user.update({
    where: { id: userId },
    data: {
      role: Role.STAFF,
      selectedRole: Role.STAFF,
      selectedMemberKind: MemberKind.STAFF,
    },
  });
  const current = await repository.findByGithubId(githubId);
  if (!current) {
    throw new Error('합성 프로필 사용자가 존재해야 합니다.');
  }

  // When
  await expect(
    repository.completeProfileIfUnchanged(current, {
      ...canonicalCompletion(
        {
          name: '합성 교직원',
          studentId: null,
          department: '인공지능학부',
        },
        MemberKind.STAFF,
      ),
      hasStaffAccess: true,
    }),
  ).resolves.toBe('completed');

  // Then
  const legacyRows = await prisma.$queryRaw<StoredProfileFields[]>`
    SELECT "name", "studentId", "department"
    FROM "User"
    WHERE "id" = ${userId}
  `;
  const profileRows = await prisma.$queryRaw<StoredProfileFields[]>`
    SELECT "name", "studentId", "department"
    FROM "UserProfile"
    WHERE "userId" = ${userId}
  `;
  expect(legacyRows).toEqual([
    { name: '합성 교직원', studentId: null, department: '인공지능학부' },
  ]);
  expect(profileRows).toEqual([
    { name: '합성 교직원', studentId: null, department: '인공지능학부' },
  ]);
  await expect(repository.findByGithubId(githubId)).resolves.toMatchObject({
    role: Role.STAFF,
    studentId: null,
    department: '인공지능학부',
  });
});

it('UserProfile 행이 없는 프로필도 이름·학과를 갱신할 수 있다', async () => {
  // Given
  await prisma.user.update({
    where: { id: userId },
    data: { role: Role.STAFF, department: '인공지능학부' },
  });

  // When
  await repository.updateProfileFields(userId, {
    name: '합성 수정 교직원',
    department: '소프트웨어공학과',
  });

  // Then
  const legacyRows = await prisma.$queryRaw<StoredProfileFields[]>`
    SELECT "name", "studentId", "department"
    FROM "User"
    WHERE "id" = ${userId}
  `;
  expect(legacyRows).toEqual([
    {
      name: '합성 수정 교직원',
      studentId: null,
      department: '소프트웨어공학과',
    },
  ]);
});

it('프로필 저장은 UserProfile과 구버전 User 컬럼을 같은 값으로 유지한다', async () => {
  // Given
  const expected = firstProfile;

  // When
  await expect(completeCurrentProfile(expected)).resolves.toBe('completed');

  // Then
  const legacyRows = await prisma.$queryRaw<StoredProfileFields[]>`
    SELECT "name", "studentId", "department"
    FROM "User"
    WHERE "id" = ${userId}
  `;
  const profileRows = await prisma.$queryRaw<StoredProfileFields[]>`
    SELECT "name", "studentId", "department"
    FROM "UserProfile"
    WHERE "userId" = ${userId}
  `;
  expect(legacyRows).toEqual([expected]);
  expect(profileRows).toEqual([expected]);
});

it('완료 후 이름·학과 수정도 UserProfile과 구버전 User 컬럼을 함께 갱신한다', async () => {
  // Given
  await expect(completeCurrentProfile(firstProfile)).resolves.toBe('completed');
  const mutableFields = {
    name: '합성 수정 사용자',
    department: '컴퓨터공학과',
  };

  // When
  await repository.updateProfileFields(userId, mutableFields);

  // Then
  const expected = { ...firstProfile, ...mutableFields };
  const legacyRows = await prisma.$queryRaw<StoredProfileFields[]>`
    SELECT "name", "studentId", "department"
    FROM "User"
    WHERE "id" = ${userId}
  `;
  const profileRows = await prisma.$queryRaw<StoredProfileFields[]>`
    SELECT "name", "studentId", "department"
    FROM "UserProfile"
    WHERE "userId" = ${userId}
  `;
  expect(legacyRows).toEqual([expected]);
  expect(profileRows).toEqual([expected]);
});
