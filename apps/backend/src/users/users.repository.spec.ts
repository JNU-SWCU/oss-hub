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
  // 가입을 마치는 순간 고른 역할이 확정된다(#569) — 그 확정이 프로필 저장과 같은
  // 트랜잭션 안에서 일어나므로 역할 요청 통로도 여기 함께 있어야 한다.
  const roleRequestFindFirst = jest.fn().mockResolvedValue(null);
  const roleRequestCreate = jest
    .fn()
    .mockResolvedValue({ id: 'synthetic-request', status: 'PENDING' });
  const transaction = {
    user: { updateMany: userUpdateMany, update: userUpdate },
    userProfile: {
      create: userProfileCreate,
      updateMany: userProfileUpdateMany,
      findUnique: userProfileFindUnique,
    },
    roleRequest: {
      findFirst: roleRequestFindFirst,
      create: roleRequestCreate,
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
    roleRequestFindFirst,
    roleRequestCreate,
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
      selectedRole: 'STUDENT',
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
      selectedRole: 'STUDENT',
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
      selectedRole: null,
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
      selectedRole: null,
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
      selectedRole: 'STAFF',
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
      department: '인공지능학부',
    });

    // Then
    expect(userProfileUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'user-legacy-only' },
      data: { name: '수정된 이름', department: '인공지능학부' },
    });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-legacy-only' },
      data: { name: '수정된 이름', department: '인공지능학부' },
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

/**
 * #569 회귀 검사 ② — **`가입 마치기`가 확정한다.**
 *
 * 프로필이 완료 저장되는 그 순간에 고른 역할이 확정된다. 학생은 `User.role`이 붙고
 * 교직원은 승인 요청이 만들어진다. 확정이 여기서 일어나지 않으면 가입을 끝까지 걸은
 * 사람이 역할 없이 남아, 다음 화면의 게이트가 그를 다시 온보딩으로 되돌린다.
 *
 * 확정을 저장과 **같은 트랜잭션**에 두는 것도 이 검사의 대상이다. 따로 떼면 그 사이에서
 * 끊겼을 때 "프로필은 완료됐는데 역할이 없는" 계정이 남고, 그 계정은 프로필 화면이
 * 이미 완료라며 곧바로 내보내므로 다시 확정될 기회를 얻지 못한다.
 */
describe('UsersRepository 가입 마치기 확정', () => {
  const student = {
    id: 'user-finishing-student',
    role: null,
    selectedRole: 'STUDENT' as const,
    name: null,
    studentId: null,
    department: null,
  };
  const staff = {
    id: 'user-finishing-staff',
    role: null,
    selectedRole: 'STAFF' as const,
    name: null,
    studentId: null,
    department: null,
  };

  it('학생으로 가입을 마치면 역할이 배정된다', async () => {
    // Given
    const { repository, userUpdateMany, roleRequestCreate } = harness();

    // When
    const completed = await repository.completeProfileIfUnchanged(student, {
      name: '합성 학생',
      studentId: '153401',
      department: '인공지능학부',
    });

    // Then — 역할이 비어 있을 때만 쓴다(CAS). 같은 순간 관리자가 역할을 붙였다면
    // 그쪽이 이긴다.
    expect(completed).toBe(true);
    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { id: student.id, role: null },
      data: { role: 'STUDENT' },
    });
    expect(roleRequestCreate).not.toHaveBeenCalled();
  });

  it('교직원으로 가입을 마치면 승인 요청이 만들어진다', async () => {
    // Given
    const { repository, roleRequestCreate, userUpdateMany } = harness();

    // When
    const completed = await repository.completeProfileIfUnchanged(staff, {
      name: '합성 교직원',
      studentId: null,
      department: '인공지능학부',
    });

    // Then
    expect(completed).toBe(true);
    expect(roleRequestCreate).toHaveBeenCalledWith({
      data: { userId: staff.id },
    });
    // 교직원은 승인 전까지 역할이 붙지 않는다.
    expect(userUpdateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: 'STAFF' } }),
    );
  });

  it('이미 승인 대기 요청이 있으면 다시 만들지 않는다', async () => {
    // Given — 사용자당 PENDING은 하나뿐이다(마이그레이션의 partial unique).
    const { repository, roleRequestFindFirst, roleRequestCreate } = harness();
    roleRequestFindFirst.mockResolvedValue({
      id: 'synthetic-existing',
      status: 'PENDING',
    });

    // When
    await repository.completeProfileIfUnchanged(staff, {
      name: '합성 교직원',
      studentId: null,
      department: '인공지능학부',
    });

    // Then
    expect(roleRequestCreate).not.toHaveBeenCalled();
  });

  it('저장 선점에 실패하면 확정도 하지 않는다', async () => {
    // Given — 같은 계정의 다른 요청이 먼저 저장을 끝냈다.
    const { repository, userUpdateMany, roleRequestCreate } = harness();
    userUpdateMany.mockResolvedValue({ count: 0 });

    // When
    const completed = await repository.completeProfileIfUnchanged(staff, {
      name: '합성 교직원',
      studentId: null,
      department: '인공지능학부',
    });

    // Then — 실패한 저장에 확정만 따라붙으면 프로필 없는 신청이 대기줄에 올라간다.
    expect(completed).toBe(false);
    expect(roleRequestCreate).not.toHaveBeenCalled();
  });

  it('고른 역할이 없으면 확정할 것도 없다', async () => {
    // Given — 마이그레이션 전에 만들어진 계정이 새 칸이 빈 채로 프로필을 고칠 수 있다.
    const { repository, userUpdateMany, roleRequestCreate } = harness();

    // When
    await repository.completeProfileIfUnchanged(
      { ...student, selectedRole: null },
      { name: '합성 사용자', studentId: '153402', department: '인공지능학부' },
    );

    // Then
    expect(roleRequestCreate).not.toHaveBeenCalled();
    expect(userUpdateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: 'STUDENT' } }),
    );
  });

  it('이미 확정된 역할은 다시 계산하지 않는다', async () => {
    // Given — 승인을 받은 교직원이 프로필을 고치러 들어왔다.
    const { repository, userUpdateMany, roleRequestCreate } = harness();

    // When
    await repository.completeProfileIfUnchanged(
      { ...staff, role: 'STAFF' as const },
      { name: '합성 교직원', studentId: null, department: '인공지능학부' },
    );

    // Then
    expect(roleRequestCreate).not.toHaveBeenCalled();
    expect(userUpdateMany).not.toHaveBeenCalledWith({
      where: { id: staff.id, role: null },
      data: { role: 'STAFF' },
    });
  });
});
