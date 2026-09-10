import { TeamInvitationStatus } from '@prisma/client';
import { TeamInvitationErrorCode } from './team-invitation-error-code.enum';
import {
  buildService,
  sentInvitationRecord,
  syntheticGithubId,
  syntheticInviteeProjection,
  syntheticLeaderId,
  syntheticProgramId,
  syntheticTeamId,
  syntheticUserId,
} from './team-invitations.service.test-support';

/** 팀 맥락 스냅샷은 팀장·정원만 싣는다 — 신청 제출 여부를 담던 열은 없앴다. */
function teamContext(leaderId: string) {
  return {
    teamId: syntheticTeamId,
    programId: syntheticProgramId,
    leaderId,
    teamMaxSize: 4,
  };
}

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
    expect(result[0]).not.toHaveProperty('invitee');
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
  it('팀장이 아닌 구성원도 보낸 초대 목록을 조회하고 허용된 이름 투영만 받는다', async () => {
    const sent = [sentInvitationRecord()];
    const { service, repository } = buildService({
      findTeamContext: jest
        .fn()
        .mockResolvedValue(teamContext(syntheticLeaderId)),
      isTeamMember: jest.fn().mockResolvedValue(true),
      findByTeamId: jest.fn().mockResolvedValue(sent),
    });

    const result = await service.listSentByTeam(
      syntheticGithubId,
      syntheticTeamId,
    );

    expect(repository.isTeamMember).toHaveBeenCalledWith(
      syntheticTeamId,
      syntheticUserId,
    );
    expect(repository.findByTeamId).toHaveBeenCalledWith(syntheticTeamId);
    expect(result).toBe(sent);
    expect(result[0]?.invitee).toEqual(syntheticInviteeProjection);
    expect(Object.keys(result[0]!.invitee).sort()).toEqual([
      'avatarUrl',
      'id',
      'name',
      'nickname',
    ]);
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
  it('팀장이면 programId 기준으로 검색하고 본인을 후보에서 제외한다', async () => {
    const candidates = [
      {
        id: 'cuid-candidate',
        nickname: 'octocat',
        name: null,
        avatarUrl: null,
      },
    ];
    const { service, repository } = buildService({
      findTeamContext: jest
        .fn()
        .mockResolvedValue(teamContext(syntheticUserId)),
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

  /**
   * 신청 제출은 초대 창구를 닫지 않는다 — 참여 중 팀 구성 관리의 게이트는
   * 팀장 권한과 정원뿐이다. 신청 이력이 있는 팀장도 후보를 계속 검색한다.
   */
  it('신청을 제출한 팀의 팀장도 후보 검색을 계속할 수 있다', async () => {
    const candidates = [
      {
        id: 'cuid-candidate',
        nickname: 'octocat',
        name: '문어',
        avatarUrl: null,
      },
    ];
    const { service, repository } = buildService({
      findTeamContext: jest
        .fn()
        .mockResolvedValue(teamContext(syntheticUserId)),
      searchCandidates: jest.fn().mockResolvedValue(candidates),
    });

    await expect(
      service.searchCandidates(syntheticGithubId, syntheticTeamId, 'octo'),
    ).resolves.toBe(candidates);
    expect(repository.searchCandidates).toHaveBeenCalledTimes(1);
  });

  it('팀장이 아니면 TIV_003으로 거부한다', async () => {
    const { service } = buildService();

    await expect(
      service.searchCandidates(syntheticGithubId, syntheticTeamId, 'octo'),
    ).rejects.toMatchObject({
      errorCode: { code: TeamInvitationErrorCode.NOT_TEAM_LEADER },
    });
  });

  /** 권한의 축은 소속이 아니라 팀장이다 — 구성원이어도 검색은 열리지 않는다. */
  it('팀 구성원이어도 팀장이 아니면 후보를 검색하지 않는다', async () => {
    const { service, repository } = buildService({
      findTeamContext: jest
        .fn()
        .mockResolvedValue(teamContext(syntheticLeaderId)),
      isTeamMember: jest.fn().mockResolvedValue(true),
    });

    await expect(
      service.searchCandidates(syntheticGithubId, syntheticTeamId, 'octo'),
    ).rejects.toMatchObject({
      errorCode: { code: TeamInvitationErrorCode.NOT_TEAM_LEADER },
    });
    expect(repository.searchCandidates).not.toHaveBeenCalled();
  });

  it('팀이 없으면 검색 전에 TIV_002로 거부한다', async () => {
    const { service, repository } = buildService({
      findTeamContext: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.searchCandidates(syntheticGithubId, syntheticTeamId, 'octo'),
    ).rejects.toMatchObject({
      errorCode: { code: TeamInvitationErrorCode.TEAM_NOT_FOUND },
    });
    expect(repository.searchCandidates).not.toHaveBeenCalled();
  });

  it('공백만 있는 검색어는 빈 배열을 반환하고 repository를 호출하지 않는다', async () => {
    const { service, repository } = buildService({
      findTeamContext: jest
        .fn()
        .mockResolvedValue(teamContext(syntheticUserId)),
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
