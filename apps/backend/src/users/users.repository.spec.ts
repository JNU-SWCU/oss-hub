import { usersRepositoryHarness as harness } from './users.repository.spec-support';

describe('UsersRepository canonical profile reads', () => {
  const syntheticPhone = '1'.repeat(11);

  it('프로필 행의 값을 그대로 읽는다', async () => {
    const { findUnique, repository } = harness();
    findUnique.mockResolvedValue({
      id: 'user-profile-first',
      githubId: 9_600_000_000_153_101n,
      nickname: 'synthetic-profile-first',
      phone: syntheticPhone,
      selectedMemberKind: 'STUDENT',
      hasStaffAccess: false,
      hasAdminAccess: false,
      staffAccessRequests: [],
      profile: {
        name: 'Profile Name',
        studentId: '222222',
        staffNumber: 'SYNTHETIC-42',
        department: 'Profile Department',
        memberKind: 'STUDENT',
        affiliationKind: 'DEPARTMENT',
        affiliationName: 'Profile Department',
      },
    });

    const result = await repository.findByGithubId(9_600_000_000_153_101n);

    expect(result).toEqual({
      id: 'user-profile-first',
      githubId: 9_600_000_000_153_101n,
      githubLogin: 'synthetic-profile-first',
      selectedMemberKind: 'STUDENT',
      memberKind: 'STUDENT',
      affiliationKind: 'DEPARTMENT',
      affiliationName: 'Profile Department',
      hasStaffAccess: false,
      hasAdminAccess: false,
      hasPendingStaffRequest: false,
      name: 'Profile Name',
      studentId: '222222',
      staffNumber: 'SYNTHETIC-42',
      department: 'Profile Department',
      phone: syntheticPhone,
    });
  });

  it('프로필 행이 없으면 세 칸이 모두 비어 있다', async () => {
    const { findUnique, repository } = harness();
    findUnique.mockResolvedValue({
      id: 'user-without-profile',
      githubId: 9_600_000_000_153_102n,
      nickname: 'synthetic-without-profile',
      phone: null,
      selectedMemberKind: null,
      hasStaffAccess: false,
      hasAdminAccess: false,
      staffAccessRequests: [],
      profile: null,
    });

    const result = await repository.findByGithubId(9_600_000_000_153_102n);

    expect(result).toEqual({
      id: 'user-without-profile',
      githubId: 9_600_000_000_153_102n,
      githubLogin: 'synthetic-without-profile',
      selectedMemberKind: null,
      memberKind: null,
      affiliationKind: null,
      affiliationName: null,
      hasStaffAccess: false,
      hasAdminAccess: false,
      hasPendingStaffRequest: false,
      name: null,
      studentId: null,
      staffNumber: null,
      department: null,
      phone: null,
    });
  });

  it('완료 판정에 쓰이도록 승인 대기 요청을 함께 조회한다', async () => {
    const { findUnique, repository } = harness();
    findUnique.mockResolvedValue({
      id: 'user-pending-staff',
      githubId: 9_600_000_000_153_103n,
      nickname: 'synthetic-pending-staff',
      phone: null,
      selectedMemberKind: 'STAFF',
      hasStaffAccess: false,
      hasAdminAccess: false,
      staffAccessRequests: [{ id: 'synthetic-pending-request' }],
      profile: null,
    });

    const result = await repository.findByGithubId(9_600_000_000_153_103n);

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
