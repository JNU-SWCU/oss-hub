import { Role } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { completeCompatibleProfileIfUnchanged } from '../profiles/profile-compatibility.repository';
import { UsersRepository } from './users.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const userId = 'test:users:profile';
const githubId = 9_600_000_000_153_001n;
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

type StoredProfileFields = {
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
};

const prisma = new PrismaService();
const repository = new UsersRepository(prisma);

async function completeCurrentProfile(
  profile: typeof firstProfile | typeof secondProfile,
): Promise<boolean> {
  const current = await repository.findByGithubId(githubId);
  if (!current) {
    throw new Error('합성 프로필 사용자가 존재해야 합니다.');
  }
  return repository.completeProfileIfUnchanged(current, profile);
}

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.user.create({
    data: {
      id: userId,
      githubId,
      nickname: 'synthetic-profile-user',
      name: 'GitHub 합성 이름',
    },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

it('학번·학과를 DB에 저장하고 다시 조회한다', async () => {
  await expect(completeCurrentProfile(firstProfile)).resolves.toBe(true);

  await expect(repository.findByGithubId(githubId)).resolves.toEqual({
    id: userId,
    role: null,
    ...firstProfile,
  });
});

it('학번 없는 교직원 프로필은 UserProfile 행 없이 legacy 컬럼에만 저장한다', async () => {
  // Given — UserProfile.studentId가 NOT NULL이라 행을 만들 수 없다(#439)
  await prisma.user.update({
    where: { id: userId },
    data: { role: Role.STAFF },
  });
  const current = await repository.findByGithubId(githubId);
  if (!current) {
    throw new Error('합성 프로필 사용자가 존재해야 합니다.');
  }

  // When
  await expect(
    repository.completeProfileIfUnchanged(current, {
      name: '합성 교직원',
      studentId: null,
      department: '인공지능학부',
    }),
  ).resolves.toBe(true);

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
  expect(profileRows).toEqual([]);
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
  await expect(completeCurrentProfile(expected)).resolves.toBe(true);

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
  await expect(completeCurrentProfile(firstProfile)).resolves.toBe(true);
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

it('완료된 프로필은 두 번째 요청으로 덮어쓰지 않는다', async () => {
  const initial = await repository.findByGithubId(githubId);
  if (!initial) {
    throw new Error('합성 프로필 사용자가 존재해야 합니다.');
  }
  await repository.completeProfileIfUnchanged(initial, firstProfile);

  await expect(
    repository.completeProfileIfUnchanged(initial, secondProfile),
  ).resolves.toBe(false);
  await expect(repository.findByGithubId(githubId)).resolves.toMatchObject(
    firstProfile,
  );
});

it('이름만 비어 있는 미완료 프로필도 다시 저장할 수 있다', async () => {
  await prisma.user.update({
    where: { id: userId },
    data: {
      name: null,
      studentId: firstProfile.studentId,
      department: firstProfile.department,
    },
  });

  await expect(completeCurrentProfile(secondProfile)).resolves.toBe(true);
  await expect(repository.findByGithubId(githubId)).resolves.toMatchObject(
    secondProfile,
  );
});

it('비어 있거나 형식이 잘못된 기존 프로필도 유효한 값으로 복구할 수 있다', async () => {
  await prisma.user.update({
    where: { id: userId },
    data: {
      name: '   ',
      studentId: '12A456',
      department: '',
    },
  });

  await expect(completeCurrentProfile(firstProfile)).resolves.toBe(true);
  await expect(repository.findByGithubId(githubId)).resolves.toMatchObject(
    firstProfile,
  );
});

it('이미 생성된 UserProfile과 충돌하면 legacy User 변경도 롤백한다', async () => {
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
    },
  });
  const legacyBefore = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { name: true, studentId: true, department: true },
  });

  // When
  const completed = repository.completeProfileIfUnchanged(
    expected,
    firstProfile,
  );

  // Then
  await expect(completed).resolves.toBe(false);
  await expect(
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, studentId: true, department: true },
    }),
  ).resolves.toEqual(legacyBefore);
});

it('동일한 완료 요청이 경쟁하면 한 요청만 성공하고 다른 요청은 CAS miss로 수렴한다', async () => {
  // Given
  await prisma.user.update({ where: { id: userId }, data: firstProfile });
  const expected = { id: userId, role: null, ...firstProfile };
  const complete = () =>
    prisma.$transaction((transaction) =>
      completeCompatibleProfileIfUnchanged(transaction, expected, firstProfile),
    );

  // When
  const results = await Promise.all([complete(), complete()]);

  // Then
  expect(results.filter((result) => result)).toHaveLength(1);
  expect(results.filter((result) => !result)).toHaveLength(1);
  await expect(repository.findByGithubId(githubId)).resolves.toEqual(expected);
});
