import { Role } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { completeCompatibleProfileIfUnchanged } from '../profiles/profile-compatibility.store';
import { UsersStore } from './users.store';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const userId = 'test:users:profile';
const githubId = 9_600_000_000_153_001n;
/** 학번 유일성이 계정 경계를 넘는지 보려면 두 번째 계정이 필요하다. */
const otherUserId = 'test:users:profile:other';
const otherGithubId = 9_600_000_000_153_002n;
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
const repository = new UsersStore(prisma);

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
  await prisma.user.deleteMany({
    where: { id: { in: [userId, otherUserId] } },
  });
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
  await prisma.user.deleteMany({
    where: { id: { in: [userId, otherUserId] } },
  });
  await prisma.$disconnect();
});

it('학번·학과를 DB에 저장하고 다시 조회한다', async () => {
  await expect(completeCurrentProfile(firstProfile)).resolves.toBe(true);

  await expect(repository.findByGithubId(githubId)).resolves.toEqual({
    id: userId,
    role: null,
    // 아직 역할을 고르기 전이다 — 프로필만 저장한다고 선택이 생기지는 않는다(#569).
    selectedRole: null,
    hasPendingStaffRequest: false,
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
  const expected = {
    id: userId,
    role: null,
    selectedRole: null,
    hasPendingStaffRequest: false,
    ...firstProfile,
  };
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

describe('학번 최초 저장의 유일성', () => {
  const staffProfile = {
    name: '합성 조교',
    department: '인공지능학부',
  };
  const graduateStudentId = '9'.repeat(6);

  /** 학번 없이 완료된 교직원 — UserProfile 행이 아직 없는 상태다. */
  async function makeLegacyOnlyStaff(
    id: string,
    github: bigint,
    nickname: string,
  ): Promise<void> {
    await prisma.user.upsert({
      where: { id },
      update: { role: Role.STAFF, ...staffProfile, studentId: null },
      create: {
        id,
        githubId: github,
        nickname,
        role: Role.STAFF,
        ...staffProfile,
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

  beforeEach(async () => {
    await makeLegacyOnlyStaff(userId, githubId, 'synthetic-profile-user');
  });

  it('UserProfile 행이 없던 교직원의 첫 학번도 제약이 걸린 행으로 저장된다', async () => {
    // Given — 예전에는 UserProfile을 0행 갱신하고 제약 없는 User 컬럼에만 남겼다
    const current = await currentProfile(githubId);

    // When
    const outcome = await repository.fillStudentId(current, {
      ...staffProfile,
      studentId: graduateStudentId,
    });

    // Then
    expect(outcome).toBe('filled');
    const profileRows = await prisma.$queryRaw<StoredProfileFields[]>`
      SELECT "name", "studentId", "department"
      FROM "UserProfile"
      WHERE "userId" = ${userId}
    `;
    expect(profileRows).toEqual([
      { ...staffProfile, studentId: graduateStudentId },
    ]);
    await expect(repository.findByGithubId(githubId)).resolves.toMatchObject({
      studentId: graduateStudentId,
    });
  });

  it('다른 계정이 이미 쓰는 학번은 두 번째 계정에 저장되지 않는다', async () => {
    // Given — 구버전 User.studentId에는 unique 제약이 없어 예전에는 둘 다 통과했다
    await makeLegacyOnlyStaff(
      otherUserId,
      otherGithubId,
      'synthetic-profile-other',
    );
    const first = await currentProfile(githubId);
    await expect(
      repository.fillStudentId(first, {
        ...staffProfile,
        studentId: graduateStudentId,
      }),
    ).resolves.toBe('filled');

    // When
    const second = await currentProfile(otherGithubId);
    const outcome = await repository.fillStudentId(second, {
      ...staffProfile,
      studentId: graduateStudentId,
    });

    // Then
    expect(outcome).toBe('taken');
    await expect(
      repository.findByGithubId(otherGithubId),
    ).resolves.toMatchObject({ studentId: null });
  });

  it('같은 계정의 동시 최초 저장은 한 건만 성공한다', async () => {
    // Given — 두 요청 모두 학번이 비어 있는 같은 상태를 읽는다
    const current = await currentProfile(githubId);
    const fill = (studentId: string) =>
      repository.fillStudentId(current, { ...staffProfile, studentId });

    // When
    const outcomes = await Promise.all([
      fill(graduateStudentId),
      fill('8'.repeat(6)),
    ]);

    // Then — 예전에는 둘 다 성공해 나중 값이 앞 값을 조용히 덮었다
    expect(outcomes.filter((outcome) => outcome === 'filled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome !== 'filled')).toHaveLength(1);
    const profileRows = await prisma.$queryRaw<StoredProfileFields[]>`
      SELECT "studentId" FROM "UserProfile" WHERE "userId" = ${userId}
    `;
    expect(profileRows).toHaveLength(1);
  });
});
