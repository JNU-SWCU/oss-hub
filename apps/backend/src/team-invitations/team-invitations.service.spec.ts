import { TeamInvitationStatus } from '@prisma/client';
import { TeamInvitationErrorCode } from './team-invitation-error-code.enum';
import {
  PendingInvitationConflictError,
  TeamInvitationsRepository,
} from './team-invitations.repository';
import { TeamInvitationsService } from './team-invitations.service';

// 합성 데이터만 사용한다 (docs/rules/security.md)
const syntheticGithubId = 424242n;
const syntheticUserId = 'cuid-synthetic-invitee';
const syntheticLeaderId = 'cuid-synthetic-leader';
const syntheticTeamId = 'cuid-synthetic-team';
const syntheticProgramId = 'cuid-synthetic-program';

type MockRepository = TeamInvitationsRepository & {
  findUserIdByGithubId: jest.Mock;
  findByInviteeId: jest.Mock;
  findByTeamId: jest.Mock;
  findTeamContext: jest.Mock;
  isTeamMember: jest.Mock;
  isUserInProgramTeam: jest.Mock;
  userExists: jest.Mock;
  countTeamMembers: jest.Mock;
  searchCandidates: jest.Mock;
  createInvitation: jest.Mock;
  closePendingInvitationAsDeclined: jest.Mock;
  findInvitationForActor: jest.Mock;
  withAcceptTransaction: jest.Mock;
};

function buildService(overrides: Partial<MockRepository> = {}): {
  service: TeamInvitationsService;
  repository: MockRepository;
} {
  const repository = {
    findUserIdByGithubId: jest.fn().mockResolvedValue(syntheticUserId),
    findByInviteeId: jest.fn().mockResolvedValue([]),
    findByTeamId: jest.fn().mockResolvedValue([]),
    findTeamContext: jest.fn().mockResolvedValue({
      teamId: syntheticTeamId,
      programId: syntheticProgramId,
      leaderId: syntheticLeaderId,
      teamMaxSize: 4,
    }),
    isTeamMember: jest.fn().mockResolvedValue(true),
    isUserInProgramTeam: jest.fn().mockResolvedValue(false),
    userExists: jest.fn().mockResolvedValue(true),
    countTeamMembers: jest.fn().mockResolvedValue(1),
    searchCandidates: jest.fn().mockResolvedValue([]),
    createInvitation: jest.fn(),
    closePendingInvitationAsDeclined: jest.fn().mockResolvedValue(1),
    findInvitationForActor: jest.fn(),
    withAcceptTransaction: jest.fn(),
    ...overrides,
  } as unknown as MockRepository;
  return {
    service: new TeamInvitationsService(repository),
    repository,
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

describe('TeamInvitationsService.create', () => {
  function leaderRepository(overrides: Partial<MockRepository> = {}) {
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
    const { service, repository } = leaderRepository({
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
    const { service } = leaderRepository();

    await expect(
      service.create(syntheticGithubId, syntheticTeamId, syntheticLeaderId),
    ).rejects.toMatchObject({
      errorCode: { code: TeamInvitationErrorCode.SELF_INVITE_FORBIDDEN },
    });
  });

  it('초대 대상 User가 없으면 TIV_006으로 거부한다', async () => {
    const { service } = leaderRepository({
      userExists: jest.fn().mockResolvedValue(false),
    });

    await expect(
      service.create(syntheticGithubId, syntheticTeamId, syntheticUserId),
    ).rejects.toMatchObject({
      errorCode: { code: TeamInvitationErrorCode.INVITEE_NOT_FOUND },
    });
  });

  it('이미 같은 프로그램 팀에 소속된 대상이면 TIV_007로 거부한다', async () => {
    const { service } = leaderRepository({
      isUserInProgramTeam: jest.fn().mockResolvedValue(true),
    });

    await expect(
      service.create(syntheticGithubId, syntheticTeamId, syntheticUserId),
    ).rejects.toMatchObject({
      errorCode: { code: TeamInvitationErrorCode.INVITEE_ALREADY_IN_TEAM },
    });
  });

  it('팀이 이미 정원이면 TIV_009로 거부한다', async () => {
    const { service } = leaderRepository({
      countTeamMembers: jest.fn().mockResolvedValue(4),
    });

    await expect(
      service.create(syntheticGithubId, syntheticTeamId, syntheticUserId),
    ).rejects.toMatchObject({
      errorCode: { code: TeamInvitationErrorCode.TEAM_FULL },
    });
  });

  it('대기 중인 초대가 이미 있으면 TIV_008로 거부한다', async () => {
    const { service } = leaderRepository({
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

describe('TeamInvitationsService.cancel', () => {
  it('팀장이 취소하면 closePendingInvitationAsDeclined을 호출한다', async () => {
    const { service, repository } = buildService({
      findUserIdByGithubId: jest.fn().mockResolvedValue(syntheticLeaderId),
      findInvitationForActor: jest.fn().mockResolvedValue({
        id: 'cuid-invitation',
        teamId: syntheticTeamId,
        programId: syntheticProgramId,
        inviteeId: syntheticUserId,
        invitedById: syntheticLeaderId,
        status: TeamInvitationStatus.PENDING,
        invitedAt: new Date(),
        respondedAt: null,
        leaderId: syntheticLeaderId,
      }),
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
      findInvitationForActor: jest.fn().mockResolvedValue({
        id: 'cuid-invitation',
        teamId: syntheticTeamId,
        programId: syntheticProgramId,
        inviteeId: syntheticUserId,
        invitedById: syntheticLeaderId,
        status: TeamInvitationStatus.PENDING,
        invitedAt: new Date(),
        respondedAt: null,
        leaderId: syntheticLeaderId,
      }),
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
        id: 'cuid-invitation',
        teamId: syntheticTeamId,
        programId: syntheticProgramId,
        inviteeId: syntheticUserId,
        invitedById: syntheticLeaderId,
        status: TeamInvitationStatus.DECLINED,
        invitedAt: new Date(),
        respondedAt: new Date(),
        leaderId: syntheticLeaderId,
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
      findInvitationForActor: jest.fn().mockResolvedValue({
        id: 'cuid-invitation',
        teamId: syntheticTeamId,
        programId: syntheticProgramId,
        inviteeId: syntheticUserId,
        invitedById: syntheticLeaderId,
        status: TeamInvitationStatus.PENDING,
        invitedAt: new Date(),
        respondedAt: null,
        leaderId: syntheticLeaderId,
      }),
    });

    await service.decline(syntheticGithubId, 'cuid-invitation');

    expect(repository.closePendingInvitationAsDeclined).toHaveBeenCalledWith(
      'cuid-invitation',
    );
  });

  it('본인이 받은 초대가 아니면 TIV_012로 거부한다', async () => {
    const { service } = buildService({
      findInvitationForActor: jest.fn().mockResolvedValue({
        id: 'cuid-invitation',
        teamId: syntheticTeamId,
        programId: syntheticProgramId,
        inviteeId: 'cuid-someone-else',
        invitedById: syntheticLeaderId,
        status: TeamInvitationStatus.PENDING,
        invitedAt: new Date(),
        respondedAt: null,
        leaderId: syntheticLeaderId,
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
