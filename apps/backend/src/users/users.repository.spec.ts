import { PrismaService } from '../platform/prisma.service';
import { UserTransitionRepository } from './user-transition.repository';
import { UsersRepository } from './users.repository';
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
        departmentType: 'DEPARTMENT',
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

describe('UsersRepository participation reads', () => {
  it('reads only approved, live team memberships of the user, newest program first', async () => {
    const membership = {
      team: {
        name: '합성 팀',
        leaderId: 'synthetic-user',
        program: { id: 'program-1', name: '합성 프로그램' },
      },
    };
    const findMany = jest.fn().mockResolvedValue([membership]);
    const repository = new UsersRepository(
      Object.assign(new PrismaService(), { teamMember: { findMany } }),
      new UserTransitionRepository(),
    );

    await expect(
      repository.listParticipationMemberships('synthetic-user'),
    ).resolves.toEqual([membership]);
    expect(findMany).toHaveBeenCalledWith({
      take: 201,
      where: {
        userId: 'synthetic-user',
        team: {
          status: 'APPROVED',
          archivedAt: null,
          program: { lifecycle: { not: 'DELETED' } },
        },
      },
      orderBy: [
        { team: { program: { startAt: 'desc' } } },
        { programId: 'asc' },
      ],
      select: {
        team: {
          select: {
            name: true,
            leaderId: true,
            program: { select: { id: true, name: true } },
          },
        },
      },
    });
  });
});
