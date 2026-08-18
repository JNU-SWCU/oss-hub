import { TeamInvitationStatus } from '@prisma/client';
import { TEAM_JOINED_AUDIT_ACTIONS } from '../audit-log/audit-log-metadata';
import type { AuditLogService } from '../audit-log/audit-log.service';
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
      expect.any(Date),
      expect.any(Function),
    );
    expect(result).toEqual({
      teamId: syntheticTeamId,
      programId: syntheticProgramId,
    });
  });

  it('records TEAM_JOINED inside the accept transaction, not after it resolves', async () => {
    let acceptResolved = false;
    const record = jest
      .fn<Promise<unknown>, Parameters<AuditLogService['record']>>()
      .mockImplementation(() => {
        expect(acceptResolved).toBe(false);
        return Promise.resolve(undefined);
      });
    const auditLogWriter = {};
    const { service } = buildService(
      {
        withAcceptTransaction: jest.fn(
          async (
            _id: string,
            _inviteeId: string,
            _now: Date,
            onOk?: (
              store: { readonly auditLogWriter: unknown },
              names: {
                readonly teamId: string;
                readonly programId: string;
                readonly teamName: string;
                readonly programName: string;
              },
            ) => Promise<void>,
          ) => {
            if (onOk) {
              await onOk(
                { auditLogWriter },
                {
                  teamId: syntheticTeamId,
                  programId: syntheticProgramId,
                  teamName: '합성 팀',
                  programName: '합성 프로그램',
                },
              );
            }
            acceptResolved = true;
            return {
              kind: 'ok' as const,
              teamId: syntheticTeamId,
              programId: syntheticProgramId,
            };
          },
        ),
      },
      { record } as Pick<AuditLogService, 'record'>,
    );

    await service.accept(syntheticGithubId, 'cuid-invitation');

    expect(record).toHaveBeenCalledTimes(1);
    expect(acceptResolved).toBe(true);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorGithubId: syntheticGithubId,
        action: TEAM_JOINED_AUDIT_ACTIONS.TEAM_JOINED,
        targetType: 'TEAM',
        targetId: syntheticTeamId,
        metadata: {
          schemaVersion: 1,
          programName: '합성 프로그램',
          teamName: '합성 팀',
        },
      }),
      auditLogWriter,
    );
  });

  it.each([
    ['not-found', TeamInvitationErrorCode.INVITATION_NOT_FOUND],
    ['forbidden', TeamInvitationErrorCode.NOT_INVITEE],
    ['not-pending', TeamInvitationErrorCode.INVITATION_NOT_PENDING],
    ['already-in-team', TeamInvitationErrorCode.INVITEE_ALREADY_IN_TEAM],
    ['team-full', TeamInvitationErrorCode.TEAM_FULL],
    ['invitee-not-eligible', TeamInvitationErrorCode.INVITEE_NOT_ELIGIBLE],
    ['team-locked', TeamInvitationErrorCode.TEAM_LOCKED_AFTER_APPLICATION],
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
