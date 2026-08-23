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
type StoredProfileFields = {
  readonly name: string;
  readonly studentId: string | null;
  readonly department: string;
  readonly memberKind: MemberKind;
  readonly affiliationKind: AffiliationKind;
  readonly affiliationName: string;
};

const prisma = new PrismaService();
const repository = new UsersRepository(prisma);

async function completeCurrentProfile(
  profile: {
    readonly name: string;
    readonly studentId: string | null;
    readonly department: string;
  },
  memberKind: MemberKind = MemberKind.STUDENT,
  affiliationKind: AffiliationKind = AffiliationKind.DEPARTMENT,
): Promise<ProfileCompletionOutcome> {
  const current = await repository.findByGithubId(githubId);
  if (!current) {
    throw new Error('합성 프로필 사용자가 존재해야 합니다.');
  }
  return repository.completeProfileIfUnchanged(
    current,
    canonicalCompletion(profile, memberKind, affiliationKind),
  );
}

function readProfileRow(): Promise<StoredProfileFields[]> {
  return prisma.$queryRaw<StoredProfileFields[]>`
    SELECT "name", "studentId", "department",
           "memberKind", "affiliationKind", "affiliationName"
    FROM "UserProfile"
    WHERE "userId" = ${userId}
  `;
}

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

it('학번·학과를 UserProfile에 저장하고 다시 조회한다', async () => {
  await expect(completeCurrentProfile(firstProfile)).resolves.toBe('completed');

  await expect(repository.findByGithubId(githubId)).resolves.toEqual({
    id: userId,
    selectedMemberKind: MemberKind.STUDENT,
    memberKind: MemberKind.STUDENT,
    affiliationKind: AffiliationKind.DEPARTMENT,
    affiliationName: firstProfile.department,
    hasStaffAccess: false,
    hasAdminAccess: false,
    hasPendingStaffRequest: false,
    ...firstProfile,
  });
});

it('학번 없는 교직원 프로필은 UserProfile 행으로 저장된다', async () => {
  // Given — STAFF는 학번이 null인 canonical 행이다
  await prisma.user.update({
    where: { id: userId },
    data: {
      selectedMemberKind: MemberKind.STAFF,
      hasStaffAccess: false,
      hasAdminAccess: false,
    },
  });

  // When
  await expect(
    completeCurrentProfile(
      {
        name: '합성 교직원',
        studentId: null,
        department: '인공지능학부',
      },
      MemberKind.STAFF,
      AffiliationKind.PROGRAM_OFFICE,
    ),
  ).resolves.toBe('completed');

  // Then
  await expect(readProfileRow()).resolves.toEqual([
    {
      name: '합성 교직원',
      studentId: null,
      department: '인공지능학부',
      memberKind: MemberKind.STAFF,
      affiliationKind: AffiliationKind.PROGRAM_OFFICE,
      affiliationName: '인공지능학부',
    },
  ]);
  await expect(repository.findByGithubId(githubId)).resolves.toMatchObject({
    selectedMemberKind: MemberKind.STAFF,
    memberKind: MemberKind.STAFF,
    affiliationKind: AffiliationKind.PROGRAM_OFFICE,
    affiliationName: '인공지능학부',
    studentId: null,
    department: '인공지능학부',
    hasStaffAccess: false,
    hasAdminAccess: false,
    hasPendingStaffRequest: true,
  });
});

it('완료된 프로필의 이름·소속을 갱신할 수 있다', async () => {
  // Given
  await prisma.user.update({
    where: { id: userId },
    data: {
      selectedMemberKind: MemberKind.STAFF,
      hasStaffAccess: false,
      hasAdminAccess: false,
    },
  });
  await expect(
    completeCurrentProfile(
      {
        name: '합성 교직원',
        studentId: null,
        department: '인공지능학부',
      },
      MemberKind.STAFF,
      AffiliationKind.PROGRAM_OFFICE,
    ),
  ).resolves.toBe('completed');

  // When
  await repository.updateProfileFields(userId, {
    name: '합성 수정 교직원',
    department: '소프트웨어공학과',
    affiliationKind: AffiliationKind.PROGRAM_OFFICE,
    affiliationName: '소프트웨어공학과',
  });

  // Then
  await expect(readProfileRow()).resolves.toEqual([
    {
      name: '합성 수정 교직원',
      studentId: null,
      department: '소프트웨어공학과',
      memberKind: MemberKind.STAFF,
      affiliationKind: AffiliationKind.PROGRAM_OFFICE,
      affiliationName: '소프트웨어공학과',
    },
  ]);
});

it('프로필 저장은 UserProfile 한 행에 canonical 사실을 남긴다', async () => {
  // Given
  const expected = firstProfile;

  // When
  await expect(completeCurrentProfile(expected)).resolves.toBe('completed');

  // Then
  await expect(readProfileRow()).resolves.toEqual([
    {
      ...expected,
      memberKind: MemberKind.STUDENT,
      affiliationKind: AffiliationKind.DEPARTMENT,
      affiliationName: expected.department,
    },
  ]);
});

it('완료 후 이름·학과 수정도 UserProfile만 갱신한다', async () => {
  // Given
  await expect(completeCurrentProfile(firstProfile)).resolves.toBe('completed');
  const mutableFields = {
    name: '합성 수정 사용자',
    department: '컴퓨터공학과',
  };

  // When
  await repository.updateProfileFields(userId, {
    ...mutableFields,
    affiliationKind: AffiliationKind.DEPARTMENT,
    affiliationName: mutableFields.department,
  });

  // Then
  await expect(readProfileRow()).resolves.toEqual([
    {
      ...firstProfile,
      ...mutableFields,
      memberKind: MemberKind.STUDENT,
      affiliationKind: AffiliationKind.DEPARTMENT,
      affiliationName: mutableFields.department,
    },
  ]);
});
