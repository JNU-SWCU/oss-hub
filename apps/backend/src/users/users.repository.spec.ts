import { usersRepositoryHarness as harness } from './users.repository.spec-support';

describe('UsersRepository profile compatibility reads', () => {
  it('prefers UserProfile fields over stale legacy User fields', async () => {
    // Given
    const { findUnique, repository } = harness();
    findUnique.mockResolvedValue({
      id: 'user-profile-first',
      role: 'STUDENT',
      staffAccessRequests: [],
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

  it('projects legacy STUDENT authority when canonical profile keys are null', async () => {
    // Given
    const { findUnique, repository } = harness();
    findUnique.mockResolvedValue({
      id: 'user-profile-null-canonical-keys',
      role: 'STUDENT',
      selectedMemberKind: null,
      hasStaffAccess: null,
      hasAdminAccess: null,
      staffAccessRequests: [],
      name: 'Legacy Name',
      studentId: '111111',
      department: 'Legacy Department',
      profile: {
        name: 'Profile Name',
        studentId: '222222',
        department: 'Profile Department',
        memberKind: null,
        affiliationKind: null,
        affiliationName: null,
      },
    });

    // When
    const result = await repository.findByGithubId(9_600_000_000_153_104n);

    // Then
    expect(result).toEqual({
      id: 'user-profile-null-canonical-keys',
      role: 'STUDENT',
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

  it('falls back to legacy User fields while no UserProfile row exists', async () => {
    // Given
    const { findUnique, repository } = harness();
    findUnique.mockResolvedValue({
      id: 'user-legacy-fallback',
      role: null,
      staffAccessRequests: [],
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
      selectedMemberKind: null,
      memberKind: null,
      affiliationKind: null,
      affiliationName: null,
      hasStaffAccess: false,
      hasAdminAccess: false,
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
      staffAccessRequests: [{ id: 'synthetic-pending-request' }],
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
