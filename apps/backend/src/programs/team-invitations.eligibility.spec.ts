import { UserProfileService } from '../users/user-profile.service';
import { PlatformRepository } from '../platform/platform.repository';
import { AccountStatus } from '@prisma/client';
import { MemberKind } from '../users/user-contract.config';
import type { AuditLogService } from '../platform/audit-log.service';
import { PrismaService } from '../platform/prisma.service';
import { TeamInvitationsRepository } from './team-invitations.repository';
import { TeamInvitationsService } from './team-invitations.service';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';

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
      {
        type: MemberKind.STUDENT,
        accountStatus: AccountStatus.ACTIVE,
      },
      'eligible',
    ],
    [
      '교직원',
      {
        type: MemberKind.STAFF,
        accountStatus: AccountStatus.ACTIVE,
      },
      'not-eligible',
    ],
    [
      '비활성 학생',
      {
        type: MemberKind.STUDENT,
        accountStatus: AccountStatus.DEACTIVATED,
      },
      'not-eligible',
    ],
    [
      '가입을 마치지 않은 계정',
      {
        name: null,
        department: null,
        type: 'UNSELECTED',
        profileCreatedAt: null,
        accountStatus: AccountStatus.ACTIVE,
      },
      'not-eligible',
    ],
  ] as const)('%s의 초대 자격을 판정한다', async (_, user, expected) => {
    const repository = Object.assign(
      new TeamInvitationsRepository(
        {
          user: {
            findUnique: jest.fn(({ where }: { where: { id: string } }) =>
              Promise.resolve(
                where.id === leaderId
                  ? {
                      type: 'STUDENT',
                      approvalStatus: 'NOT_REQUIRED',
                      accountStatus: AccountStatus.ACTIVE,
                      name: 'Synthetic leader',
                      department: 'Synthetic department',
                      studentId: '123456',
                      departmentType: 'DEPARTMENT',
                      admin: null,
                      profileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
                      profileUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
                    }
                  : user,
              ),
            ),
          },
        } as unknown as PrismaService,
        new PlatformRepository(),
      ),
      {
        findUserIdByGithubId: jest.fn().mockResolvedValue(leaderId),
        findTeamContext: jest.fn().mockResolvedValue({
          teamId,
          programId,
          leaderId,
          teamMaxSize: 4,
        }),
        createInvitation: jest.fn().mockResolvedValue({ kind: 'team-full' }),
      },
    );
    const service = new TeamInvitationsService(
      repository,
      { record: jest.fn() } as unknown as AuditLogService,
      new AuditLogMetadataService(),
      new UserProfileService(),
    );

    const invitation = service.create(leaderGithubId, teamId, inviteeId);

    await expect(invitation).rejects.toMatchObject({
      errorCode: {
        code: {
          'not-found': 'TIV_006',
          'not-eligible': 'TIV_013',
          eligible: 'TIV_009',
        }[expected],
      },
    });
    expect(repository.createInvitation).toHaveBeenCalledTimes(
      expected === 'eligible' ? 1 : 0,
    );
  });

  it('후보 검색은 ACTIVE STUDENT만 조회한다', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repository = new TeamInvitationsRepository(
      {
        user: { findMany },
      } as unknown as PrismaService,
      new PlatformRepository(),
    );

    await repository.searchCandidates(programId, 'octo', leaderId);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: MemberKind.STUDENT,
          accountStatus: AccountStatus.ACTIVE,
        }) as unknown,
      }),
    );
  });

  it('교직원 계정 직접 초대를 TIV_013으로 거부한다', async () => {
    const repository = {
      findUserIdByGithubId: jest.fn().mockResolvedValue(leaderId),
      findTeamContext: jest.fn().mockResolvedValue({
        teamId,
        programId,
        leaderId,
        teamMaxSize: 4,
      }),
      findInviteeAccount: jest.fn().mockResolvedValue({
        accountStatus: AccountStatus.ACTIVE,
        type: MemberKind.STAFF,
      }),
      findStaffAuthority: jest.fn().mockResolvedValue(null),
      isUserInProgramTeam: jest.fn().mockResolvedValue(false),
      countTeamMembers: jest.fn().mockResolvedValue(1),
      createInvitation: jest.fn(),
    };
    const service = new TeamInvitationsService(
      repository as unknown as TeamInvitationsRepository,
      { record: jest.fn() } as unknown as AuditLogService,
      new AuditLogMetadataService(),
      new UserProfileService(),
    );

    const invitation = service.create(leaderGithubId, teamId, inviteeId);

    await expect(invitation).rejects.toMatchObject({
      errorCode: { code: 'TIV_013' },
    });
    expect(repository.createInvitation).not.toHaveBeenCalled();
  });

  it('수락 시점에 ACTIVE STUDENT가 아니면 팀원을 만들지 않는다', async () => {
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
    const repository = new TeamInvitationsRepository(
      {
        $transaction: <T>(operation: (client: typeof tx) => Promise<T>) =>
          operation(tx),
      } as unknown as PrismaService,
      new PlatformRepository(),
    );

    const outcome = await repository.withAcceptTransaction(
      'cuid-synthetic-invitation',
      inviteeId,
    );

    expect(tx.user.findUnique).toHaveBeenCalledWith({
      where: { id: inviteeId },
      select: {
        id: true,
        type: true,
        accountStatus: true,
      },
    });
    expect(outcome).toEqual({ kind: 'invitee-not-eligible' });
    expect(tx.teamMember.create).not.toHaveBeenCalled();
  });
});
