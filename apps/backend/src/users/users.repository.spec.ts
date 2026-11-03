import { usersRepositoryHarness } from './users.repository.spec-support';
import { profileRecord } from './member-authority-test-fixtures';

describe('UsersRepository flat profile reads', () => {
  it('reads canonical User fields and the current approval tuple', async () => {
    const marker = new Date('2026-01-01');
    const { repository } = usersRepositoryHarness(
      profileRecord('profile', {
        name: 'Profile Name',
        studentId: '222222',
        department: 'Profile Department',
        staffNumber: 'SYNTHETIC-42',
        phone: '11111111111',
        memberKind: 'STUDENT',
        selectedMemberKind: 'STUDENT',
        affiliationKind: 'DEPARTMENT',
        affiliationName: 'Profile Department',
        profileCreatedAt: marker,
      }),
    );
    expect(await repository.findByGithubId(4242n)).toMatchObject({
      id: 'profile',
      name: 'Profile Name',
      studentId: '222222',
      department: 'Profile Department',
      staffNumber: 'SYNTHETIC-42',
      phone: '11111111111',
      memberKind: 'STUDENT',
      selectedMemberKind: 'STUDENT',
      approvalStatus: 'NOT_REQUIRED',
      approvalRequestId: null,
      profileCreatedAt: marker,
    });
  });
  it('preserves an unselected account separately from a missing profile', async () => {
    const { repository } = usersRepositoryHarness(
      profileRecord('unselected', {
        memberKind: null,
        selectedMemberKind: null,
      }),
    );
    expect(await repository.findByGithubId(4242n)).toMatchObject({
      memberKind: null,
      selectedMemberKind: null,
      name: null,
      studentId: null,
      department: null,
      profileCreatedAt: null,
      approvalStatus: 'NOT_REQUIRED',
    });
  });
  it.each([null, 'submitted-request'] as const)(
    'only projects a submitted pending request when id=%s',
    async (approvalRequestId) => {
      const { repository } = usersRepositoryHarness(
        profileRecord('pending', {
          memberKind: 'STAFF',
          selectedMemberKind: 'STAFF',
          approvalStatus: 'PENDING',
          approvalRequestId,
        }),
      );
      expect(await repository.findByGithubId(4242n)).toMatchObject({
        memberKind: 'STAFF',
        selectedMemberKind: 'STAFF',
        hasPendingStaffRequest: approvalRequestId !== null,
        profileCreatedAt: null,
      });
    },
  );
});
