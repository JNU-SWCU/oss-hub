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

describe('TeamInvitationsService.listReceived', () => {
  it('세션 githubId를 userId로 바꿔 받은 초대 목록을 조회한다', async () => {
    const invitations = [
      {
        id: 'cuid-synthetic-invitation-1',
        teamId: syntheticTeamId,
        programId: syntheticProgramId,
        inviteeId: syntheticUserId,
        invitedById: syntheticLeaderId,
        status: TeamInvitationStatus.PENDING,
        invitedAt: new Date('2026-08-01T00:00:00.000Z'),
        respondedAt: null,
      },
    ];
    const { service, repository } = buildService({
      findByInviteeId: jest.fn().mockResolvedValue(invitations),
    });

    const result = await service.listReceived(syntheticGithubId);

    expect(repository.findUserIdByGithubId).toHaveBeenCalledWith(
      syntheticGithubId,
    );
    expect(repository.findByInviteeId).toHaveBeenCalledWith(syntheticUserId);
    expect(result).toBe(invitations);
  });

  it('githubId에 대응하는 User가 없으면 TIV_001로 거부한다', async () => {
    const { service } = buildService({
      findUserIdByGithubId: jest.fn().mockResolvedValue(null),
    });

    await expect(service.listReceived(syntheticGithubId)).rejects.toMatchObject(
      {
        errorCode: { code: TeamInvitationErrorCode.UNAUTHENTICATED },
      },
    );
  });
});

describe('TeamInvitationsService.listSentByTeam', () => {
  it('팀 구성원이면 보낸 초대 목록을 조회한다', async () => {
    const { service, repository } = buildService({
      isTeamMember: jest.fn().mockResolvedValue(true),
    });

    await service.listSentByTeam(syntheticGithubId, syntheticTeamId);

    expect(repository.isTeamMember).toHaveBeenCalledWith(
      syntheticTeamId,
      syntheticUserId,
    );
    expect(repository.findByTeamId).toHaveBeenCalledWith(syntheticTeamId);
  });

  it('팀이 없으면 TIV_002로 거부한다', async () => {
    const { service } = buildService({
      findTeamContext: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.listSentByTeam(syntheticGithubId, syntheticTeamId),
    ).rejects.toMatchObject({
      errorCode: { code: TeamInvitationErrorCode.TEAM_NOT_FOUND },
    });
  });

  it('팀 구성원이 아니면 TIV_004로 거부한다', async () => {
    const { service } = buildService({
      isTeamMember: jest.fn().mockResolvedValue(false),
    });

    await expect(
      service.listSentByTeam(syntheticGithubId, syntheticTeamId),
    ).rejects.toMatchObject({
      errorCode: { code: TeamInvitationErrorCode.NOT_TEAM_MEMBER },
    });
  });
});

describe('TeamInvitationsService.searchCandidates', () => {
  it('팀장이면 programId 기준으로 검색한다', async () => {
    const candidates = [
      {
        id: 'cuid-candidate',
        nickname: 'octocat',
        name: null,
        avatarUrl: null,
      },
    ];
    const { service, repository } = buildService({
      findTeamContext: jest.fn().mockResolvedValue({
        teamId: syntheticTeamId,
        programId: syntheticProgramId,
        leaderId: syntheticUserId,
        teamMaxSize: 4,
      }),
      searchCandidates: jest.fn().mockResolvedValue(candidates),
    });

    const result = await service.searchCandidates(
      syntheticGithubId,
      syntheticTeamId,
      '  octo  ',
    );

    expect(repository.searchCandidates).toHaveBeenCalledWith(
      syntheticProgramId,
      'octo',
      syntheticUserId,
    );
    expect(result).toBe(candidates);
  });

  it('팀장이 아니면 TIV_003으로 거부한다', async () => {
    const { service } = buildService();

    await expect(
      service.searchCandidates(syntheticGithubId, syntheticTeamId, 'octo'),
    ).rejects.toMatchObject({
      errorCode: { code: TeamInvitationErrorCode.NOT_TEAM_LEADER },
    });
  });

  it('신청을 제출한 팀은 초대 후보를 검색할 수 없다', async () => {
    const { service, repository } = buildService({
      findTeamContext: jest.fn().mockResolvedValue({
        teamId: syntheticTeamId,
        programId: syntheticProgramId,
        leaderId: syntheticUserId,
        teamMaxSize: 4,
        locked: true,
      }),
    });

    await expect(
      service.searchCandidates(syntheticGithubId, syntheticTeamId, 'octo'),
    ).rejects.toMatchObject({
      errorCode: {
        code: TeamInvitationErrorCode.TEAM_LOCKED_AFTER_APPLICATION,
      },
    });
    expect(repository.searchCandidates).not.toHaveBeenCalled();
  });

  it('공백만 있는 검색어는 빈 배열을 반환하고 repository를 호출하지 않는다', async () => {
    const { service, repository } = buildService({
      findTeamContext: jest.fn().mockResolvedValue({
        teamId: syntheticTeamId,
        programId: syntheticProgramId,
        leaderId: syntheticUserId,
        teamMaxSize: 4,
      }),
    });

    const result = await service.searchCandidates(
      syntheticGithubId,
      syntheticTeamId,
      '   ',
    );

    expect(result).toEqual([]);
    expect(repository.searchCandidates).not.toHaveBeenCalled();
  });
});
