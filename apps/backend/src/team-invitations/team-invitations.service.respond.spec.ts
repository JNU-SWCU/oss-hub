import { TeamInvitationStatus } from '@prisma/client';
import { TeamInvitationErrorCode } from './team-invitation-error-code.enum';
import {
  buildService,
  syntheticGithubId,
  syntheticLeaderId,
  syntheticProgramId,
  syntheticTeamId,
  syntheticUserId,
} from './team-invitations.service.test-support';

function pendingInvitation() {
  return {
    id: 'cuid-invitation',
    teamId: syntheticTeamId,
    programId: syntheticProgramId,
    inviteeId: syntheticUserId,
    invitedById: syntheticLeaderId,
    status: TeamInvitationStatus.PENDING,
    invitedAt: new Date(),
    respondedAt: null,
    leaderId: syntheticLeaderId,
  };
}

describe('TeamInvitationsService.cancel', () => {
  it('팀장이 취소하면 closePendingInvitationAsDeclined을 호출한다', async () => {
    const { service, repository } = buildService({
      findUserIdByGithubId: jest.fn().mockResolvedValue(syntheticLeaderId),
      findInvitationForActor: jest.fn().mockResolvedValue(pendingInvitation()),
    });

    await service.cancel(syntheticGithubId, 'cuid-invitation');

    expect(repository.closePendingInvitationAsDeclined).toHaveBeenCalledWith(
      'cuid-invitation',
    );
  });

  it('존재하지 않는 초대면 TIV_010으로 거부한다', async () => {
    const { service } = buildService({
      findInvitationForActor: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.cancel(syntheticGithubId, 'cuid-invitation'),
    ).rejects.toMatchObject({
      errorCode: { code: TeamInvitationErrorCode.INVITATION_NOT_FOUND },
    });
  });

  it('팀장이 아니면 TIV_003으로 거부한다', async () => {
    const { service } = buildService({
      findInvitationForActor: jest.fn().mockResolvedValue(pendingInvitation()),
    });

    await expect(
      service.cancel(syntheticGithubId, 'cuid-invitation'),
    ).rejects.toMatchObject({
      errorCode: { code: TeamInvitationErrorCode.NOT_TEAM_LEADER },
    });
  });

  it('이미 응답된 초대면 TIV_011로 거부한다', async () => {
    const { service } = buildService({
      findUserIdByGithubId: jest.fn().mockResolvedValue(syntheticLeaderId),
      findInvitationForActor: jest.fn().mockResolvedValue({
        ...pendingInvitation(),
        status: TeamInvitationStatus.DECLINED,
        respondedAt: new Date(),
      }),
      closePendingInvitationAsDeclined: jest.fn().mockResolvedValue(0),
    });

    await expect(
      service.cancel(syntheticGithubId, 'cuid-invitation'),
    ).rejects.toMatchObject({
      errorCode: { code: TeamInvitationErrorCode.INVITATION_NOT_PENDING },
    });
  });
});

describe('TeamInvitationsService.decline', () => {
  it('초대받은 본인이 거절하면 closePendingInvitationAsDeclined을 호출한다', async () => {
    const { service, repository } = buildService({
      findInvitationForActor: jest.fn().mockResolvedValue(pendingInvitation()),
    });

    await service.decline(syntheticGithubId, 'cuid-invitation');

    expect(repository.closePendingInvitationAsDeclined).toHaveBeenCalledWith(
      'cuid-invitation',
    );
  });

  it('본인이 받은 초대가 아니면 TIV_012로 거부한다', async () => {
    const { service } = buildService({
      findInvitationForActor: jest.fn().mockResolvedValue({
        ...pendingInvitation(),
        inviteeId: 'cuid-someone-else',
      }),
    });

    await expect(
      service.decline(syntheticGithubId, 'cuid-invitation'),
    ).rejects.toMatchObject({
      errorCode: { code: TeamInvitationErrorCode.NOT_INVITEE },
    });
  });
});

describe('TeamInvitationsService.accept', () => {
  it('수락에 성공하면 teamId·programId를 반환한다', async () => {
    const { service, repository } = buildService({
      withAcceptTransaction: jest.fn().mockResolvedValue({
        kind: 'ok',
        teamId: syntheticTeamId,
        programId: syntheticProgramId,
      }),
    });

    const result = await service.accept(syntheticGithubId, 'cuid-invitation');

    expect(repository.withAcceptTransaction).toHaveBeenCalledWith(
      'cuid-invitation',
      syntheticUserId,
    );
    expect(result).toEqual({
      teamId: syntheticTeamId,
      programId: syntheticProgramId,
    });
  });

  it.each([
    ['not-found', TeamInvitationErrorCode.INVITATION_NOT_FOUND],
    ['forbidden', TeamInvitationErrorCode.NOT_INVITEE],
    ['not-pending', TeamInvitationErrorCode.INVITATION_NOT_PENDING],
    ['already-in-team', TeamInvitationErrorCode.INVITEE_ALREADY_IN_TEAM],
    ['team-full', TeamInvitationErrorCode.TEAM_FULL],
    ['invitee-not-eligible', TeamInvitationErrorCode.INVITEE_NOT_ELIGIBLE],
  ] as const)('outcome %s는 %s로 매핑된다', async (kind, expectedCode) => {
    const { service } = buildService({
      withAcceptTransaction: jest.fn().mockResolvedValue({ kind }),
    });

    await expect(
      service.accept(syntheticGithubId, 'cuid-invitation'),
    ).rejects.toMatchObject({
      errorCode: { code: expectedCode },
    });
  });
});
