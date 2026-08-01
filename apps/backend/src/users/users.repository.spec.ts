import type { PrismaService } from '../prisma/prisma.service';
import { UsersRepository } from './users.repository';

type TransactionCallback<T> = (transaction: unknown) => Promise<T>;

function harness() {
  const findUnique = jest.fn();
  const userUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const userUpdate = jest.fn().mockResolvedValue({});
  const userProfileCreate = jest.fn().mockResolvedValue({});
  const userProfileUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
  const transaction = {
    user: { updateMany: userUpdateMany, update: userUpdate },
    userProfile: {
      create: userProfileCreate,
      updateMany: userProfileUpdateMany,
    },
  };
  const prisma = {
    user: { findUnique },
    $transaction: <T>(callback: TransactionCallback<T>) =>
      callback(transaction),
  } as unknown as PrismaService;
  return {
    findUnique,
    userUpdateMany,
    userUpdate,
    userProfileCreate,
    userProfileUpdateMany,
    repository: new UsersRepository(prisma),
  };
}

describe('UsersRepository profile compatibility reads', () => {
  it('prefers UserProfile fields over stale legacy User fields', async () => {
    // Given
    const { findUnique, repository } = harness();
    findUnique.mockResolvedValue({
      id: 'user-profile-first',
      role: 'STUDENT',
      name: 'Legacy Name',
      studentId: '111111',
      department: 'Legacy Department',
      profile: {
        name: 'Profile Name',
        studentId: '222222',
        department: 'Profile Department',
      },
    });

    // When
    const result = await repository.findByGithubId(9_600_000_000_153_101n);

    // Then
    expect(result).toEqual({
      id: 'user-profile-first',
      role: 'STUDENT',
      name: 'Profile Name',
      studentId: '222222',
      department: 'Profile Department',
    });
  });

  it('falls back to legacy User fields while no UserProfile row exists', async () => {
    // Given
    const { findUnique, repository } = harness();
    findUnique.mockResolvedValue({
      id: 'user-legacy-fallback',
      role: null,
      name: 'Legacy Name',
      studentId: null,
      department: null,
      profile: null,
    });

    // When
    const result = await repository.findByGithubId(9_600_000_000_153_102n);

    // Then
    expect(result).toEqual({
      id: 'user-legacy-fallback',
      role: null,
      name: 'Legacy Name',
      studentId: null,
      department: null,
    });
  });

  it('완료 판정에 쓰이도록 role을 함께 조회한다', async () => {
    // Given
    const { findUnique, repository } = harness();
    findUnique.mockResolvedValue({
      id: 'user-role-selected',
      role: 'STAFF',
      name: 'Legacy Name',
      studentId: null,
      department: '인공지능학부',
      profile: null,
    });

    // When
    await repository.findByGithubId(9_600_000_000_153_103n);

    // Then
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ role: true }) as unknown,
      }),
    );
  });
});

describe('UsersRepository profile completion writes', () => {
  const expected = {
    id: 'user-complete',
    role: null,
    name: null,
    studentId: null,
    department: null,
  };

  it('세 항목이 모두 있으면 UserProfile 행까지 만든다', async () => {
    // Given
    const { repository, userUpdateMany, userProfileCreate } = harness();

    // When
    const completed = await repository.completeProfileIfUnchanged(expected, {
      name: '합성 사용자',
      studentId: '153401',
      department: '인공지능학부',
    });

    // Then
    expect(completed).toBe(true);
    expect(userUpdateMany).toHaveBeenCalledTimes(1);
    expect(userProfileCreate).toHaveBeenCalledWith({
      data: {
        userId: 'user-complete',
        name: '합성 사용자',
        studentId: '153401',
        department: '인공지능학부',
      },
    });
  });

  it.each([
    [
      '학번 없는 교직원',
      { name: '합성 사용자', studentId: null, department: '인공지능학부' },
    ],
    [
      '학번·학과 없는 관리자',
      { name: '합성 사용자', studentId: null, department: null },
    ],
  ] as const)(
    '%s은 UserProfile 행 없이 legacy User 컬럼에만 저장한다',
    async (_label, input) => {
      // Given — UserProfile.studentId·department가 NOT NULL이라 행을 만들 수 없다
      const { repository, userUpdateMany, userProfileCreate } = harness();

      // When
      const completed = await repository.completeProfileIfUnchanged(
        expected,
        input,
      );

      // Then
      expect(completed).toBe(true);
      expect(userProfileCreate).not.toHaveBeenCalled();
      expect(userUpdateMany).toHaveBeenCalledWith({
        where: {
          id: 'user-complete',
          name: null,
          studentId: null,
          department: null,
        },
        data: input,
      });
    },
  );

  it('legacy 저장도 선점에 실패하면 false를 돌려준다', async () => {
    // Given
    const { repository, userUpdateMany } = harness();
    userUpdateMany.mockResolvedValue({ count: 0 });

    // When / Then
    await expect(
      repository.completeProfileIfUnchanged(expected, {
        name: '합성 사용자',
        studentId: null,
        department: null,
      }),
    ).resolves.toBe(false);
  });
});

describe('UsersRepository profile field updates', () => {
  it('UserProfile 행이 없어도 실패하지 않고 User 컬럼을 갱신한다', async () => {
    // Given
    const { repository, userProfileUpdateMany, userUpdate } = harness();

    // When
    await repository.updateProfileFields('user-legacy-only', {
      name: '수정된 이름',
    });

    // Then
    expect(userProfileUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'user-legacy-only' },
      data: { name: '수정된 이름' },
    });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-legacy-only' },
      data: { name: '수정된 이름' },
    });
  });
});
