import { TeamInvitationStatus } from '@prisma/client';
import { TeamInvitationErrorCode } from './team-invitation-error-code.enum';
import { PendingInvitationConflictError } from './team-invitations.repository';
import {
  buildService,
  type MockRepository,
  syntheticGithubId,
  syntheticLeaderId,
  syntheticProgramId,
  syntheticTeamId,
  syntheticUserId,
} from './team-invitations.service.test-support';

function leaderService(overrides: Partial<MockRepository> = {}) {
  return buildService({
    findUserIdByGithubId: jest.fn().mockResolvedValue(syntheticLeaderId),
    findTeamContext: jest.fn().mockResolvedValue({
      teamId: syntheticTeamId,
      programId: syntheticProgramId,
      leaderId: syntheticLeaderId,
      teamMaxSize: 4,
    }),
    ...overrides,
  });
}

describe('TeamInvitationsService.create', () => {
  it('팀장이 대상을 초대하면 repository.createInvitation을 호출한다', async () => {
    const created = {
      id: 'cuid-invitation',
      teamId: syntheticTeamId,
      programId: syntheticProgramId,
      inviteeId: syntheticUserId,
      invitedById: syntheticLeaderId,
      status: TeamInvitationStatus.PENDING,
      invitedAt: new Date(),
      respondedAt: null,
    };
    const { service, repository } = leaderService({
      createInvitation: jest.fn().mockResolvedValue(created),
    });

    const result = await service.create(
      syntheticGithubId,
      syntheticTeamId,
      syntheticUserId,
    );

    expect(repository.createInvitation).toHaveBeenCalledWith({
      teamId: syntheticTeamId,
      programId: syntheticProgramId,
      inviteeId: syntheticUserId,
      invitedById: syntheticLeaderId,
    });
    expect(result).toBe(created);
  });

  it('팀장이 아니면 TIV_003으로 거부한다', async () => {
    const { service } = buildService({
      findUserIdByGithubId: jest.fn().mockResolvedValue(syntheticUserId),
      findTeamContext: jest.fn().mockResolvedValue({
        teamId: syntheticTeamId,
        programId: syntheticProgramId,
        leaderId: syntheticLeaderId,
        teamMaxSize: 4,
      }),
    });

    await expect(
      service.create(syntheticGithubId, syntheticTeamId, 'cuid-someone'),
    ).rejects.toMatchObject({
      errorCode: { code: TeamInvitationErrorCode.NOT_TEAM_LEADER },
    });
  });

  it('자기 자신을 초대하면 TIV_005로 거부한다', async () => {
    const { service } = leaderService();

    await expect(
      service.create(syntheticGithubId, syntheticTeamId, syntheticLeaderId),
    ).rejects.toMatchObject({
      errorCode: { code: TeamInvitationErrorCode.SELF_INVITE_FORBIDDEN },
    });
  });

  it('초대 대상 User가 없으면 TIV_006으로 거부한다', async () => {
    const { service } = leaderService({
      getInviteeEligibility: jest.fn().mockResolvedValue('not-found'),
    });

    await expect(
      service.create(syntheticGithubId, syntheticTeamId, syntheticUserId),
    ).rejects.toMatchObject({
      errorCode: { code: TeamInvitationErrorCode.INVITEE_NOT_FOUND },
    });
  });

  it('이미 같은 프로그램 팀에 소속된 대상이면 TIV_007로 거부한다', async () => {
    const { service } = leaderService({
      isUserInProgramTeam: jest.fn().mockResolvedValue(true),
    });

    await expect(
      service.create(syntheticGithubId, syntheticTeamId, syntheticUserId),
    ).rejects.toMatchObject({
      errorCode: { code: TeamInvitationErrorCode.INVITEE_ALREADY_IN_TEAM },
    });
  });

  it('팀이 이미 정원이면 TIV_009로 거부한다', async () => {
    const { service } = leaderService({
      countTeamMembers: jest.fn().mockResolvedValue(4),
    });

    await expect(
      service.create(syntheticGithubId, syntheticTeamId, syntheticUserId),
    ).rejects.toMatchObject({
      errorCode: { code: TeamInvitationErrorCode.TEAM_FULL },
    });
  });

  it('대기 중인 초대가 이미 있으면 TIV_008로 거부한다', async () => {
    const { service } = leaderService({
      createInvitation: jest
        .fn()
        .mockRejectedValue(new PendingInvitationConflictError()),
    });

    await expect(
      service.create(syntheticGithubId, syntheticTeamId, syntheticUserId),
    ).rejects.toMatchObject({
      errorCode: { code: TeamInvitationErrorCode.ALREADY_INVITED },
    });
  });
});
