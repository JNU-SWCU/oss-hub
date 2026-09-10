import { TeamInvitationErrorCode } from './team-invitation-error-code.enum';
import type { CreateInvitationOutcome } from './team-invitations.repository';
import {
  buildService,
  type MockRepository,
  sentInvitationRecord,
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

function outcomeService(
  outcome: CreateInvitationOutcome,
  overrides: Partial<MockRepository> = {},
) {
  const createInvitation = jest.fn().mockResolvedValue(outcome);
  const built = leaderService({ createInvitation, ...overrides });
  return { ...built, createInvitation };
}

describe('TeamInvitationsService.create', () => {
  it('팀장이 대상을 초대하면 잠금 안 재판정용 입력으로 createInvitation을 호출한다', async () => {
    const created = sentInvitationRecord();
    const { service, createInvitation } = outcomeService({
      kind: 'ok',
      invitation: created,
    });

    const result = await service.create(
      syntheticGithubId,
      syntheticTeamId,
      syntheticUserId,
    );

    // programId·invitedById를 서비스가 정하지 않는다 — 잠근 팀 행에서 다시 읽는다.
    expect(createInvitation).toHaveBeenCalledWith({
      teamId: syntheticTeamId,
      actorId: syntheticLeaderId,
      inviteeId: syntheticUserId,
    });
    expect(result).toBe(created);
    expect(result.invitee).toEqual({
      id: syntheticUserId,
      nickname: 'synthetic-invitee',
      name: '합성 초대 대상',
      avatarUrl: 'https://example.invalid/avatar.png',
    });
  });

  it('신청을 제출한 뒤에도 참여 중인 팀은 새 팀원을 초대할 수 있다', async () => {
    const created = sentInvitationRecord();
    const { service, createInvitation } = outcomeService(
      { kind: 'ok', invitation: created },
      {
        // 신청이 있는 팀의 예전 스냅샷(locked)이 와도 초대를 막지 않는다.
        findTeamContext: jest.fn().mockResolvedValue({
          teamId: syntheticTeamId,
          programId: syntheticProgramId,
          leaderId: syntheticLeaderId,
          teamMaxSize: 4,
          locked: true,
        }),
      },
    );

    await expect(
      service.create(syntheticGithubId, syntheticTeamId, syntheticUserId),
    ).resolves.toBe(created);
    expect(createInvitation).toHaveBeenCalledTimes(1);
  });

  it('팀장이 아니면 TIV_003으로 거부하고 대상 정보를 읽지 않는다', async () => {
    const { service, repository } = buildService({
      findUserIdByGithubId: jest.fn().mockResolvedValue(syntheticUserId),
      findTeamContext: jest.fn().mockResolvedValue({
        teamId: syntheticTeamId,
        programId: syntheticProgramId,
        leaderId: syntheticLeaderId,
        teamMaxSize: 4,
      }),
      createInvitation: jest.fn(),
    });

    await expect(
      service.create(syntheticGithubId, syntheticTeamId, 'cuid-someone'),
    ).rejects.toMatchObject({
      errorCode: { code: TeamInvitationErrorCode.NOT_TEAM_LEADER },
    });
    expect(repository.getInviteeEligibility).not.toHaveBeenCalled();
    expect(repository.createInvitation).not.toHaveBeenCalled();
  });

  it('팀이 없으면 TIV_002로 거부한다', async () => {
    const { service } = leaderService({
      findTeamContext: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.create(syntheticGithubId, syntheticTeamId, syntheticUserId),
    ).rejects.toMatchObject({
      errorCode: { code: TeamInvitationErrorCode.TEAM_NOT_FOUND },
    });
  });

  it('자기 자신을 초대하면 TIV_005로 거부한다', async () => {
    const { service, repository } = leaderService({
      createInvitation: jest.fn(),
    });

    await expect(
      service.create(syntheticGithubId, syntheticTeamId, syntheticLeaderId),
    ).rejects.toMatchObject({
      errorCode: { code: TeamInvitationErrorCode.SELF_INVITE_FORBIDDEN },
    });
    expect(repository.createInvitation).not.toHaveBeenCalled();
  });

  it('초대 대상 User가 없으면 TIV_006으로 거부한다', async () => {
    const { service, repository } = leaderService({
      getInviteeEligibility: jest.fn().mockResolvedValue('not-found'),
      createInvitation: jest.fn(),
    });

    await expect(
      service.create(syntheticGithubId, syntheticTeamId, syntheticUserId),
    ).rejects.toMatchObject({
      errorCode: { code: TeamInvitationErrorCode.INVITEE_NOT_FOUND },
    });
    expect(repository.createInvitation).not.toHaveBeenCalled();
  });

  it('승인된 활성 학생이 아니면 TIV_013으로 거부한다', async () => {
    const { service, repository } = leaderService({
      getInviteeEligibility: jest.fn().mockResolvedValue('not-eligible'),
      createInvitation: jest.fn(),
    });

    await expect(
      service.create(syntheticGithubId, syntheticTeamId, syntheticUserId),
    ).rejects.toMatchObject({
      errorCode: { code: TeamInvitationErrorCode.INVITEE_NOT_ELIGIBLE },
    });
    expect(repository.createInvitation).not.toHaveBeenCalled();
  });

  it.each([
    ['team-not-found', TeamInvitationErrorCode.TEAM_NOT_FOUND],
    ['not-team-leader', TeamInvitationErrorCode.NOT_TEAM_LEADER],
    ['not-team-member', TeamInvitationErrorCode.NOT_TEAM_MEMBER],
    [
      'invitee-already-in-team',
      TeamInvitationErrorCode.INVITEE_ALREADY_IN_TEAM,
    ],
    ['team-full', TeamInvitationErrorCode.TEAM_FULL],
    ['already-invited', TeamInvitationErrorCode.ALREADY_INVITED],
  ] as const)(
    '생성 트랜잭션 outcome %s는 %s로 매핑된다',
    async (kind, expectedCode) => {
      const { service } = leaderService({
        createInvitation: jest.fn().mockResolvedValue({ kind }),
      });

      await expect(
        service.create(syntheticGithubId, syntheticTeamId, syntheticUserId),
      ).rejects.toMatchObject({ errorCode: { code: expectedCode } });
    },
  );

  it('기다리는 사이 팀장이 바뀌면 사전 통과와 무관하게 TIV_003으로 거부한다', async () => {
    // 사전 조회는 아직 이 사람을 팀장으로 본다. 팀 행을 잠근 트랜잭션만이 정본이다.
    const { service, createInvitation } = outcomeService({
      kind: 'not-team-leader',
    });

    await expect(
      service.create(syntheticGithubId, syntheticTeamId, syntheticUserId),
    ).rejects.toMatchObject({
      errorCode: { code: TeamInvitationErrorCode.NOT_TEAM_LEADER },
    });
    expect(createInvitation).toHaveBeenCalledTimes(1);
  });

  it('기다리는 사이 초대자가 팀을 떠났으면 TIV_004로 거부한다', async () => {
    const { service } = outcomeService({ kind: 'not-team-member' });

    await expect(
      service.create(syntheticGithubId, syntheticTeamId, syntheticUserId),
    ).rejects.toMatchObject({
      errorCode: { code: TeamInvitationErrorCode.NOT_TEAM_MEMBER },
    });
  });
});
