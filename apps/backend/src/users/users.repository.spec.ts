import type { PrismaService } from '../prisma/prisma.service';
import { UsersRepository } from './users.repository';

type TransactionCallback<T> = (transaction: unknown) => Promise<T>;

function harness() {
  const findUnique = jest.fn();
  const userUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const userUpdate = jest.fn().mockResolvedValue({});
  const userProfileCreate = jest.fn().mockResolvedValue({});
  const userProfileUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
  const userProfileFindUnique = jest.fn().mockResolvedValue(null);
  const transaction = {
    user: { updateMany: userUpdateMany, update: userUpdate },
    userProfile: {
      create: userProfileCreate,
      updateMany: userProfileUpdateMany,
      findUnique: userProfileFindUnique,
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
    userProfileFindUnique,
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
      roleRequests: [],
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
      hasPendingStaffRequest: false,
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
      roleRequests: [],
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
      hasPendingStaffRequest: false,
      name: 'Legacy Name',
      studentId: null,
      department: null,
    });
  });

  it('완료 판정에 쓰이도록 role과 승인 대기 요청을 함께 조회한다', async () => {
    // Given
    const { findUnique, repository } = harness();
    findUnique.mockResolvedValue({
      id: 'user-role-selected',
      role: 'STAFF',
      roleRequests: [{ id: 'synthetic-pending-request' }],
      name: 'Legacy Name',
      studentId: null,
      department: '인공지능학부',
      profile: null,
    });

    // When
    const result = await repository.findByGithubId(9_600_000_000_153_103n);

    // Then — 승인을 기다리는 교직원은 role이 아직 null이라, 이 표시가 없으면 학생
    // 기준으로 판정돼 학번을 요구받는다.
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ role: true }) as unknown,
      }),
    );
    expect(result).toMatchObject({ hasPendingStaffRequest: true });
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

describe('UsersRepository 학번 최초 저장', () => {
  const expected = {
    id: 'user-legacy-only',
    role: 'STAFF' as const,
    name: '합성 교직원',
    studentId: null,
    department: '인공지능학부',
  };
  const profile = {
    name: '합성 교직원',
    studentId: '153406',
    department: '인공지능학부',
  };

  it('UserProfile 행이 없던 교직원도 행을 만들어 제약 아래 학번을 넣는다', async () => {
    // Given — 갱신 경로(updateMany)는 0행을 갱신하고 제약 없는 User 컬럼만 남겼다
    const { repository, userProfileUpdateMany, userProfileCreate } = harness();

    // When
    const outcome = await repository.fillStudentId(expected, profile);

    // Then
    expect(outcome).toBe('filled');
    expect(userProfileCreate).toHaveBeenCalledWith({
      data: { userId: expected.id, ...profile },
    });
    expect(userProfileUpdateMany).not.toHaveBeenCalled();
  });

  it('다른 계정이 소유한 학번은 쓰지 않고 taken을 돌려준다', async () => {
    // Given
    const { repository, userProfileFindUnique, userUpdateMany } = harness();
    userProfileFindUnique.mockResolvedValue({ userId: 'other-user' });

    // When / Then
    await expect(repository.fillStudentId(expected, profile)).resolves.toBe(
      'taken',
    );
    expect(userUpdateMany).not.toHaveBeenCalled();
  });
});

describe('UsersRepository 완료 저장의 학번 경로', () => {
  it('학번이 실렸는데 학과가 없으면 조용히 legacy에 쓰지 않고 멈춘다', async () => {
    // Given — 이 조합은 서비스가 먼저 400으로 막아야 한다(USR_005)
    const { repository, userUpdateMany } = harness();

    // When / Then
    await expect(
      repository.completeProfileIfUnchanged(
        {
          id: 'user-admin',
          role: 'ADMIN',
          name: null,
          studentId: null,
          department: null,
        },
        { name: '합성 관리자', studentId: '153407', department: null },
      ),
    ).rejects.toThrow('학번을 저장하려면 학과가 필요합니다');
    expect(userUpdateMany).not.toHaveBeenCalled();
  });
});
