import { AccountStatus } from '@prisma/client';
import type { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { TeamInvitationsRepository } from './team-invitations.repository';
import { TeamInvitationsService } from './team-invitations.service';

const programId = 'cuid-synthetic-program';
const teamId = 'cuid-synthetic-team';
const leaderId = 'cuid-synthetic-leader';
const inviteeId = 'cuid-synthetic-invitee';
const leaderGithubId = 424242n;

describe('팀 초대 대상 자격', () => {
  it.each([
    ['없는 계정', null, 'not-found'],
    [
      '활성 학생',
      { role: 'STUDENT', accountStatus: AccountStatus.ACTIVE },
      'eligible',
    ],
    [
      '교직원',
      { role: 'STAFF', accountStatus: AccountStatus.ACTIVE },
      'not-eligible',
    ],
    [
      '비활성 학생',
      { role: 'STUDENT', accountStatus: AccountStatus.DEACTIVATED },
      'not-eligible',
    ],
  ] as const)('%s의 초대 자격을 판정한다', async (_, user, expected) => {
    // Given
    const repository = new TeamInvitationsRepository({
      user: { findUnique: jest.fn().mockResolvedValue(user) },
    } as unknown as PrismaService);

    // When
    const result = await repository.getInviteeEligibility(inviteeId);

    // Then
    expect(result).toBe(expected);
  });

  it('후보 검색은 ACTIVE STUDENT만 조회한다', async () => {
    // Given
    const findMany = jest.fn().mockResolvedValue([]);
    const repository = new TeamInvitationsRepository({
      user: { findMany },
    } as unknown as PrismaService);

    // When
    await repository.searchCandidates(programId, 'octo', leaderId);

    // Then
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: 'STUDENT',
          accountStatus: AccountStatus.ACTIVE,
        }) as unknown,
      }),
    );
  });

  it('교직원 계정 직접 초대를 TIV_013으로 거부한다', async () => {
    // Given
    const repository = {
      findUserIdByGithubId: jest.fn().mockResolvedValue(leaderId),
      findTeamContext: jest.fn().mockResolvedValue({
        teamId,
        programId,
        leaderId,
        teamMaxSize: 4,
      }),
      getInviteeEligibility: jest.fn().mockResolvedValue('not-eligible'),
      isUserInProgramTeam: jest.fn().mockResolvedValue(false),
      countTeamMembers: jest.fn().mockResolvedValue(1),
      createInvitation: jest.fn(),
    };
    const service = new TeamInvitationsService(
      repository as unknown as TeamInvitationsRepository,
      { record: jest.fn() } as unknown as AuditLogService,
    );

    // When
    const invitation = service.create(leaderGithubId, teamId, inviteeId);

    // Then
    await expect(invitation).rejects.toMatchObject({
      errorCode: { code: 'TIV_013' },
    });
    expect(repository.createInvitation).not.toHaveBeenCalled();
  });

  it('수락 시점에 ACTIVE STUDENT가 아니면 팀원을 만들지 않는다', async () => {
    // Given
    const tx = {
      teamInvitation: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'cuid-synthetic-invitation',
            teamId,
            programId,
            inviteeId,
            team: { program: { teamMaxSize: 4 } },
          })
          .mockResolvedValueOnce({ status: 'PENDING' }),
        updateMany: jest.fn(),
      },
      application: { findFirst: jest.fn().mockResolvedValue(null) },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      teamMember: {
        findUnique: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: teamId }]),
    };
    const repository = new TeamInvitationsRepository({
      $transaction: <T>(operation: (client: typeof tx) => Promise<T>) =>
        operation(tx),
    } as unknown as PrismaService);

    // When
    const outcome = await repository.withAcceptTransaction(
      'cuid-synthetic-invitation',
      inviteeId,
    );

    // Then
    expect(tx.user.findUnique).toHaveBeenCalledWith({
      where: { id: inviteeId },
      select: {
        id: true,
        hasStaffAccess: true,
        hasAdminAccess: true,
        accountStatus: true,
      },
    });
    expect(outcome).toEqual({ kind: 'invitee-not-eligible' });
    expect(tx.teamMember.create).not.toHaveBeenCalled();
  });
});
