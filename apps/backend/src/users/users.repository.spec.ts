import { usersRepositoryHarness as harness } from './users.repository.spec-support';

/**
 * 프로필 읽기의 정본은 `UserProfile` 행 하나다.
 *
 * 계약 마이그레이션이 `User`의 이름·학번·학과 mirror를 지운 뒤로는 "어느 쪽이 이기는가"를
 * 묻는 fallback이 없다 — 행이 있으면 그 값이고, 없으면 아직 가입을 마치지 않은 사람이다.
 */
describe('UsersRepository canonical profile reads', () => {
  it('프로필 행의 값을 그대로 읽는다', async () => {
    // Given
    const { findUnique, repository } = harness();
    findUnique.mockResolvedValue({
      id: 'user-profile-first',
      selectedMemberKind: 'STUDENT',
      hasStaffAccess: false,
      hasAdminAccess: false,
      staffAccessRequests: [],
      profile: {
        name: 'Profile Name',
        studentId: '222222',
        department: 'Profile Department',
        memberKind: 'STUDENT',
        affiliationKind: 'DEPARTMENT',
        affiliationName: 'Profile Department',
      },
    });

    // When
    const result = await repository.findByGithubId(9_600_000_000_153_101n);

    // Then
    expect(result).toEqual({
      id: 'user-profile-first',
      selectedMemberKind: 'STUDENT',
      memberKind: 'STUDENT',
      affiliationKind: 'DEPARTMENT',
      affiliationName: 'Profile Department',
      hasStaffAccess: false,
      hasAdminAccess: false,
      hasPendingStaffRequest: false,
      name: 'Profile Name',
      studentId: '222222',
      department: 'Profile Department',
    });
  });

  it('프로필 행이 없으면 세 칸이 모두 비어 있다', async () => {
    // Given — 아직 가입을 마치지 않은 계정
    const { findUnique, repository } = harness();
    findUnique.mockResolvedValue({
      id: 'user-without-profile',
      selectedMemberKind: null,
      hasStaffAccess: false,
      hasAdminAccess: false,
      staffAccessRequests: [],
      profile: null,
    });

    // When
    const result = await repository.findByGithubId(9_600_000_000_153_102n);

    // Then
    expect(result).toEqual({
      id: 'user-without-profile',
      selectedMemberKind: null,
      memberKind: null,
      affiliationKind: null,
      affiliationName: null,
      hasStaffAccess: false,
      hasAdminAccess: false,
      hasPendingStaffRequest: false,
      name: null,
      studentId: null,
      department: null,
    });
  });

  it('완료 판정에 쓰이도록 승인 대기 요청을 함께 조회한다', async () => {
    // Given
    const { findUnique, repository } = harness();
    findUnique.mockResolvedValue({
      id: 'user-pending-staff',
      selectedMemberKind: 'STAFF',
      hasStaffAccess: false,
      hasAdminAccess: false,
      staffAccessRequests: [{ id: 'synthetic-pending-request' }],
      profile: null,
    });

    // When
    const result = await repository.findByGithubId(9_600_000_000_153_103n);

    // Then — 승인을 기다리는 교직원은 아직 프로필 행이 없어, 이 표시가 없으면
    // 학생 기준으로 판정돼 학번을 요구받는다.
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          staffAccessRequests: expect.anything() as unknown,
        }) as unknown,
      }),
    );
    expect(result).toMatchObject({ hasPendingStaffRequest: true });
  });
});
